import * as fs from 'fs';
import { EOL } from 'os';
import { window, workspace, Range, Position } from 'vscode';
const gitCommitId = require('git-commit-id');

import { CsvEntry } from './interfaces';
import {
  removeLeadingAndTrailingSlash,
  removeTrailingSlash,
  escapeDoubleQuotesForCsv,
  startLineNumberFromStringDefinition,
  endLineNumberFromStringDefinition,
} from './utils/workspace-util';
import { CommentListEntry } from './comment-list-entry';

export class ReviewCommentService {
  constructor(private reviewFile: string, private workspaceRoot: string) {}

  colorizeSelection(selections: Range[]) {
    const decoration = window.createTextEditorDecorationType({
      backgroundColor: 'rgba(200, 200, 50, 0.15)',
    });
    const editor = window.activeTextEditor ?? window.visibleTextEditors[0];
    editor.setDecorations(decoration, selections);
    return decoration;
  }

  /**
   * Append a new comment
   * @param comment the comment message
   */
  async addComment(comment: CsvEntry) {
    const newEntry: CsvEntry = { ...comment };
    this.checkFileExists();

    const editorRef = window.activeTextEditor ?? window.visibleTextEditors[0];

    if (!editorRef?.selection) {
      window.showErrorMessage(`Error referencing file/lines, Please select again.`);
      return;
    } else {
      // 2:2-12:2|19:0-19:0
      newEntry.lines = editorRef.selections.reduce((acc, cur) => {
        const tmp = acc ? `${acc}|` : '';
        return `${tmp}${cur.start.line + 1}:${cur.start.character}-${cur.end.line + 1}:${cur.end.character}`;
      }, '');
      newEntry.filename = editorRef.document.fileName.replace(this.workspaceRoot, '');
    }
    // escape double quotes
    fs.appendFileSync(this.reviewFile, this.buildCsvString(newEntry));
  }

  /**
   * Modify an existing comment
   * @param comment the comment message
   */
  async updateComment(comment: CsvEntry) {
    this.checkFileExists();

    const oldFileContent = fs.readFileSync(this.reviewFile, 'utf8'); // get old content
    const rows = oldFileContent.split(EOL);
    const updateRowIndex = rows.findIndex((row) => row.includes(comment.filename) && row.includes(comment.lines));
    if (updateRowIndex >= -1) {
      rows[updateRowIndex] = this.buildCsvString(comment);
    } else {
      window.showErrorMessage(
        `Update failed. Cannot find line definition '${comment.lines}' for '${comment.filename}' in '${this.reviewFile}'.`,
      );
    }
    fs.writeFileSync(this.reviewFile, rows.join(EOL));
  }

  async deleteComment(entry: CommentListEntry) {
    this.checkFileExists();

    const oldFileContent = fs.readFileSync(this.reviewFile, 'utf8'); // get old content
    const rows = oldFileContent.split(EOL);
    const updateRowIndex = rows.findIndex((row) => row.includes(entry.label) && row.includes(entry.text));
    if (updateRowIndex >= -1) {
      rows.splice(updateRowIndex, 1);
    } else {
      window.showErrorMessage(`Update failed. Cannot delete comment '${entry.label}' in '${this.reviewFile}'.`);
    }
    fs.writeFileSync(this.reviewFile, rows.join(EOL));
  }

  private buildCsvString(comment: CsvEntry): string {
    // escape double quotes
    const commentExcaped = escapeDoubleQuotesForCsv(comment.comment);
    const titleExcaped = comment.title ? escapeDoubleQuotesForCsv(comment.title) : '';
    const priority = comment.priority || 0;
    const additional = comment.additional ? escapeDoubleQuotesForCsv(comment.additional) : '';
    const category = comment.category || '';

    let sha = '';
    try {
      sha = gitCommitId({ cwd: this.workspaceRoot });
    } catch (error) {
      sha = '';
      console.log('Not in a git repository. Leaving SHA empty', error);
    }

    const startAnker = startLineNumberFromStringDefinition(comment.lines);
    const endAnker = endLineNumberFromStringDefinition(comment.lines);
    const remoteUrl = this.remoteUrl(sha, comment.filename, startAnker, endAnker);

    return `"${sha}","${comment.filename}","${remoteUrl}","${comment.lines}","${titleExcaped}","${commentExcaped}","${priority}","${category}","${additional}"${EOL}`;
  }

  /**
   * Build the remote URL
   * @param sha a git SHA that's included in the URL
   * @param filePath the relative file path
   * @param start the first line from the first selection
   * @param end the last line from the first selection
   */
  private remoteUrl(sha: string, filePath: string, start?: number, end?: number) {
    const customUrl = workspace.getConfiguration().get('code-review.customUrl') as string;
    const baseUrl = workspace.getConfiguration().get('code-review.baseUrl') as string;

    const filePathWithoutLeadingAndTrailingSlash = removeLeadingAndTrailingSlash(filePath);

    if (!baseUrl && !customUrl) {
      return '';
    } else if (customUrl) {
      return customUrl
        .replace('{sha}', sha)
        .replace('{file}', filePathWithoutLeadingAndTrailingSlash)
        .replace('{start}', start ? start.toString() : '0')
        .replace('{end}', end ? end.toString() : '0');
    } else {
      const baseUrlWithoutTrailingSlash = removeTrailingSlash(baseUrl);
      const shaPart = sha ? `${sha}/` : '';
      const ankerPart = start && end ? `#L${start}-L${end}` : '';
      return `${baseUrlWithoutTrailingSlash}/${shaPart}${filePathWithoutLeadingAndTrailingSlash}${ankerPart}`;
    }
  }

  private checkFileExists() {
    if (!fs.existsSync(this.reviewFile)) {
      window.showErrorMessage(`Could not add to file: '${this.reviewFile}': File does not exist`);
      return;
    }
  }
}
