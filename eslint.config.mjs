import globals from 'globals'
import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from 'typescript-eslint'

export default [{
  files: ['**/*.ts'],
  ignores: ['node_modules', 'dist', 'test/**'],
  plugins: {
    '@typescript-eslint': typescriptEslint.plugin,
    '@stylistic': stylistic
  },
  languageOptions: {
    parser: typescriptEslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      ...globals.node
    }
  },
  rules: {
    '@typescript-eslint/naming-convention': ['warn', {
      selector: 'import',
      format: ['camelCase', 'PascalCase']
    }],
    '@stylistic/brace-style': ['error', '1tbs'],
    '@stylistic/member-delimiter-style': [
      'error',
      {
        multiline: {
          delimiter: 'none',
          requireLast: false
        },
        singleline: {
          delimiter: 'comma',
          requireLast: false
        }
      }
    ],
    'comma-dangle': ['error', 'never'],
    'eol-last': ['error', 'always'],
    'no-throw-literal': 'warn',
    'quote-props': ['error', 'as-needed'],
    'constructor-super': 'warn',
    'no-const-assign': 'warn',
    'no-this-before-super': 'warn',
    'no-undef': 'warn',
    'no-unreachable': 'warn',
    'no-unused-vars': 'warn',
    'valid-typeof': 'warn',
    curly: ['error', 'multi-or-nest'],
    eqeqeq: 'error',
    indent: ['error', 2, { SwitchCase: 1 }],
    quotes: ['error', 'single', { allowTemplateLiterals: true }],
    semi: ['error', 'never']
  }
}]
