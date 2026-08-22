import React, { useContext, useRef } from 'react';
import ReactMarkdown, { defaultUrlTransform, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useOrionStore } from '../store';
import { localMediaSrc, videoFileNamePattern } from './attachments';

// Candidate base directories (in priority order) used to resolve relative
// media paths that agents emit in markdown — the thread's project path, plus
// provider-specific output dirs (e.g. the grok CLI's session dir, where Grok
// Imagine saves generated images and references them relatively).
export const MarkdownBaseDirContext = React.createContext<string[]>([]);

const bareSourceLocationPattern = /^(?!(?:javascript|data|vbscript|https?|mailto|tel):)(?:[^:/?#]+[\\/])*[^:/?#]+:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/i;

// react-markdown's default transform strips unknown schemes; let local file
// references through so MarkdownMedia can route them via orion-attachment.
export const markdownUrlTransform = (url: string) =>
  /^(orion-attachment|file):/i.test(url) ||
  /^[a-zA-Z]:[\\/]/.test(url) ||
  bareSourceLocationPattern.test(url)
    ? url
    : defaultUrlTransform(url);

export const MarkdownMedia: React.FC<{ src?: string; alt?: string; title?: string }> = ({
  src,
  alt,
  title,
}) => {
  const baseDirs = useContext(MarkdownBaseDirContext);
  if (!src) return null;

  const resolvedSrc = /^(https?|data|blob|orion-attachment):/i.test(src)
    ? src
    : localMediaSrc(src, baseDirs);

  if (videoFileNamePattern.test(src)) {
    return (
      <video
        className="markdown-media"
        src={resolvedSrc}
        controls
        preload="metadata"
        title={title ?? alt}
      />
    );
  }
  return <img className="markdown-media" src={resolvedSrc} alt={alt ?? ''} title={title} loading="lazy" />;
};

export const MarkdownLink: React.FC<React.ComponentPropsWithoutRef<'a'> & ExtraProps> = ({
  href,
  children,
  node: _node,
  ...props
}) => {
  const baseDirs = useContext(MarkdownBaseDirContext);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!href || href.startsWith('#') || !window.orion) return;

    void (async () => {
      try {
        const webHref = href.startsWith('//') ? `https:${href}` : href;
        if (/^https?:\/\//i.test(webHref)) {
          const result = await window.orion.openExternalUrl(webHref);
          if (!result.ok) toast.error(result.error ?? 'Could not open the link.');
          return;
        }

        const result = await window.orion.openLinkedFile({ href, baseDirs });
        if (!result.ok || !result.path || result.content === undefined) {
          toast.error(result.error ?? 'Could not open the linked file.');
          return;
        }
        const store = useOrionStore.getState();
        store.openFile(result.path, result.content);
        store.setSettingsOpen(false);
        store.setActiveTab('code');
      } catch {
        toast.error('Could not open the link.');
      }
    })();
  };

  return (
    <a {...props} href={href} onClick={handleClick}>
      {children}
    </a>
  );
};

export const markdownComponents = { img: MarkdownMedia, a: MarkdownLink };

export const MarkdownContent: React.FC<{ content: string }> = React.memo(({ content }) => (
  <div className="markdown-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={markdownUrlTransform}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  </div>
));

// How large the live (re-parsed every render) tail of a streaming message may
// grow before its stable prefix is frozen into a memoized segment.
const STREAMING_FREEZE_THRESHOLD = 3000;

// A boundary where `text` can be split into two independently rendered
// markdown documents without changing what they render: after a blank line,
// outside any code fence, where the next line opens a fresh top-level block —
// not a list item, indented code, table row, or blockquote, all of which could
// belong to the block above the blank line (splitting a loose list, for
// example, would restart its numbering). Returns the index the second document
// starts at, or -1 when the text holds no such point.
const findStreamingCut = (text: string): number => {
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  let offset = 0;
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
    }
    if (!inFence && i > 0 && line.trim() === '') {
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === '') next += 1;
      // The final line may still be mid-stream; never cut directly before it.
      if (next < lines.length - 1) {
        const opener = lines[next];
        const continuesPriorBlock = /^(\s{4,}|\s*([-*+]\s|\d{1,9}[.)]\s|>|\|))/.test(opener);
        if (!continuesPriorBlock) {
          let start = offset + line.length + 1;
          for (let j = i + 1; j < next; j += 1) start += lines[j].length + 1;
          cut = start;
        }
      }
    }
    offset += line.length + 1;
  }
  return cut;
};

type FrozenMarkdown = { segments: string[]; joined: string };

/**
 * Markdown for content that is still being appended to. Re-rendering a plain
 * MarkdownContent re-parses the entire text on every streamed chunk — an
 * O(transcript²) churn that grinds long turns and balloons the renderer's
 * native memory (the cause of the runaway-memory crashes on long threads).
 * This wrapper freezes the already-streamed prefix into memoized segments at
 * safe block boundaries, so each update re-parses only a small live tail.
 */
export const StreamingMarkdownContent: React.FC<{ content: string }> = React.memo(({ content }) => {
  const frozenRef = useRef<FrozenMarkdown>({ segments: [], joined: '' });
  let frozen = frozenRef.current;
  // Anything but a pure append (a different message's text after a key reuse,
  // a segment re-split by a new activity anchor) invalidates the frozen
  // prefix: start over from the new text.
  if (frozen.joined && !content.startsWith(frozen.joined)) {
    frozen = { segments: [], joined: '' };
    frozenRef.current = frozen;
  }
  let tail = content.slice(frozen.joined.length);
  if (tail.length > STREAMING_FREEZE_THRESHOLD) {
    const cut = findStreamingCut(tail);
    if (cut > 0) {
      frozen = {
        segments: [...frozen.segments, tail.slice(0, cut)],
        joined: frozen.joined + tail.slice(0, cut),
      };
      frozenRef.current = frozen;
      tail = content.slice(frozen.joined.length);
    }
  }
  return (
    <>
      {frozen.segments.map((segment, index) => (
        <MarkdownContent key={index} content={segment} />
      ))}
      {tail.trim() ? <MarkdownContent content={tail} /> : null}
    </>
  );
});
