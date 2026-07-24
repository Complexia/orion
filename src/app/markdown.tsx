import React, { useContext } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { localMediaSrc, videoFileNamePattern } from './attachments';

// Candidate base directories (in priority order) used to resolve relative
// media paths that agents emit in markdown — the thread's project path, plus
// provider-specific output dirs (e.g. the grok CLI's session dir, where Grok
// Imagine saves generated images and references them relatively).
export const MarkdownBaseDirContext = React.createContext<string[]>([]);

// react-markdown's default transform strips unknown schemes; let local file
// references through so MarkdownMedia can route them via orion-attachment.
export const markdownUrlTransform = (url: string) =>
  /^(orion-attachment|file):/i.test(url) || /^[a-zA-Z]:[\\/]/.test(url)
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

export const markdownComponents = { img: MarkdownMedia };

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
