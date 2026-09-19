import { TreeItem, TreeItemCollapsibleState, Uri } from 'vscode'

/**
 * Tree item that carries the absolute file-system path it represents.
 *
 * Commands invoked from the view context menu receive the tree item itself, so
 * the path must travel with the item. Encoding it in `tooltip` (as the tree
 * view used to do) breaks silently as soon as a tooltip changes.
 */
export default class AudioLabTreeItem extends TreeItem {
  /** Absolute file-system path of the resource this item points at, if any. */
  readonly fullPath?: string

  constructor(labelOrUri: string | Uri, collapsibleState: TreeItemCollapsibleState, fullPath?: string) {
    // `TreeItem` accepts either a label or a resource URI, but declares them as
    // two separate overloads, so the union has to be narrowed here.
    if (labelOrUri instanceof Uri) super(labelOrUri, collapsibleState)
    else super(labelOrUri, collapsibleState)
    this.fullPath = fullPath
  }
}
