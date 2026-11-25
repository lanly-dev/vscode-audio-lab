/*
 * audiolab-recorder — tiny cross-platform microphone recorder for Audio Lab.
 *
 * Records the default capture device to a 16 kHz mono 16-bit WAV file for a
 * fixed number of seconds, then exits. Built on miniaudio (single header,
 * vendored beside this file): WASAPI on Windows, CoreAudio on macOS,
 * ALSA/PulseAudio on Linux — one source, no ffmpeg, no runtime dependencies.
 *
 * The WAV file is written by hand (a fixed 44-byte PCM header, sizes patched
 * in at close) rather than with miniaudio's encoder: in miniaudio 0.11.22
 * the WAV encoder backend lives under the decoding gate, so building with
 * MA_NO_DECODING silently removes it (encoder init fails MA_NO_BACKEND).
 * Writing the one fixed format this tool needs is ~30 lines and keeps every
 * size trim on.
 *
 * Usage: audiolab-recorder <output.wav> [seconds]
 *   seconds defaults to 10 and is clamped to 1..3600.
 * Exit code 0 on success; errors go to stderr with a non-zero exit, and a
 * failed run deletes its partial output file.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

/* Capture only — keep everything else out of the binary. */
#define MA_NO_DECODING
#define MA_NO_NODE_GRAPH
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_GENERATION
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#define SAMPLE_RATE 16000
#define CHANNELS 1
#define BITS_PER_SAMPLE 16
#define BLOCK_ALIGN (CHANNELS * BITS_PER_SAMPLE / 8)

typedef struct {
    FILE *pFile;
    ma_uint64 framesWritten;
} wav_writer;

static void write_u32le(FILE *pFile, ma_uint32 value) {
    unsigned char bytes[4];
    bytes[0] = (unsigned char)(value & 0xFF);
    bytes[1] = (unsigned char)((value >> 8) & 0xFF);
    bytes[2] = (unsigned char)((value >> 16) & 0xFF);
    bytes[3] = (unsigned char)((value >> 24) & 0xFF);
    fwrite(bytes, 1, 4, pFile);
}

static void write_u16le(FILE *pFile, ma_uint16 value) {
    unsigned char bytes[2];
    bytes[0] = (unsigned char)(value & 0xFF);
    bytes[1] = (unsigned char)((value >> 8) & 0xFF);
    fwrite(bytes, 1, 2, pFile);
}

/* Canonical 44-byte PCM WAV header with zero data size; patched at close. */
static void wav_write_header(FILE *pFile) {
    fwrite("RIFF", 1, 4, pFile);
    write_u32le(pFile, 0); /* RIFF chunk size, patched later */
    fwrite("WAVE", 1, 4, pFile);
    fwrite("fmt ", 1, 4, pFile);
    write_u32le(pFile, 16); /* fmt chunk size */
    write_u16le(pFile, 1);  /* PCM */
    write_u16le(pFile, CHANNELS);
    write_u32le(pFile, SAMPLE_RATE);
    write_u32le(pFile, SAMPLE_RATE * BLOCK_ALIGN); /* byte rate */
    write_u16le(pFile, BLOCK_ALIGN);
    write_u16le(pFile, BITS_PER_SAMPLE);
    fwrite("data", 1, 4, pFile);
    write_u32le(pFile, 0); /* data size, patched later */
}

static void wav_patch_sizes(wav_writer *pWriter) {
    ma_uint32 dataSize = (ma_uint32)(pWriter->framesWritten * BLOCK_ALIGN);
    fseek(pWriter->pFile, 4, SEEK_SET);
    write_u32le(pWriter->pFile, 36 + dataSize);
    fseek(pWriter->pFile, 40, SEEK_SET);
    write_u32le(pWriter->pFile, dataSize);
}

static void sleep_ms(unsigned int ms) {
#ifdef _WIN32
    Sleep(ms);
#else
    usleep(ms * 1000);
#endif
}

static void on_data(ma_device *pDevice, void *pOutput, const void *pInput, ma_uint32 frameCount) {
    wav_writer *pWriter = (wav_writer *)pDevice->pUserData;
    (void)pOutput;
    if (pWriter != NULL && pInput != NULL) {
        pWriter->framesWritten += fwrite(pInput, BLOCK_ALIGN, frameCount, pWriter->pFile);
    }
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "audiolab-recorder: usage: %s <output.wav> [seconds]\n", argv[0]);
        return 2;
    }
    const char *outputPath = argv[1];
    int seconds = 10;
    if (argc >= 3) {
        seconds = atoi(argv[2]);
        if (seconds < 1) seconds = 1;
        if (seconds > 3600) seconds = 3600;
    }

    wav_writer writer;
    writer.framesWritten = 0;
    writer.pFile = fopen(outputPath, "wb");
    if (writer.pFile == NULL) {
        fprintf(stderr, "audiolab-recorder: cannot open output file: %s\n", outputPath);
        return 1;
    }
    wav_write_header(writer.pFile);

    ma_device device;
    ma_device_config deviceConfig = ma_device_config_init(ma_device_type_capture);
    deviceConfig.capture.format = ma_format_s16;
    deviceConfig.capture.channels = CHANNELS;
    deviceConfig.sampleRate = SAMPLE_RATE;
    deviceConfig.dataCallback = on_data;
    deviceConfig.pUserData = &writer;

    ma_result result;
#ifdef RECORDER_FORCE_NULL_BACKEND
    /* Test builds only: capture from miniaudio's null backend (silence) so
       the WAV pipeline can be verified on machines with no microphone. */
    ma_backend backends[] = { ma_backend_null };
    result = ma_device_init_ex(backends, 1, NULL, &deviceConfig, &device);
#else
    result = ma_device_init(NULL, &deviceConfig, &device);
#endif
    if (result != MA_SUCCESS) {
        fprintf(stderr, "audiolab-recorder: no capture device available (error %d)\n", (int)result);
        fclose(writer.pFile);
        remove(outputPath);
        return 1;
    }

    if (ma_device_start(&device) != MA_SUCCESS) {
        fprintf(stderr, "audiolab-recorder: failed to start capture device\n");
        ma_device_uninit(&device);
        fclose(writer.pFile);
        remove(outputPath);
        return 1;
    }

    /* Sleep in slices so the total duration stays accurate without one
       long platform-specific wait. */
    int remainingMs = seconds * 1000;
    while (remainingMs > 0) {
        int slice = remainingMs > 100 ? 100 : remainingMs;
        sleep_ms((unsigned int)slice);
        remainingMs -= slice;
    }

    ma_device_stop(&device);
    ma_device_uninit(&device);
    wav_patch_sizes(&writer);
    fclose(writer.pFile);
    return 0;
}
