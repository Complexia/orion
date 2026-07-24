import Editor, { loader, type EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Use bundled Monaco instead of the CDN. Keeping this configuration beside
// the editor means neither package enters the renderer's startup graph.
loader.config({ monaco });

export default function MonacoEditor(props: EditorProps) {
  return <Editor {...props} />;
}
