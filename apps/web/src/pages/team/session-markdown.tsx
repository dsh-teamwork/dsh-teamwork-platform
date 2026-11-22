import { createContext, useContext } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { fileReference } from '@dsh-teamwork/relay-client';
import type { FileTarget } from './session-files';

const OpenFile = createContext<((file: FileTarget) => void) | undefined>(undefined);
const InsideLink = createContext(false);

const components: Components = {
  table({ node: _node, ...props }) {
    return <div className="session-markdown-table" tabIndex={0}><table {...props} /></div>;
  },
  code: function MarkdownCode({ node: _node, className, children, ...props }) {
    const openFile = useContext(OpenFile);
    const insideLink = useContext(InsideLink);
    const file = openFile && !insideLink && !className && typeof children === 'string' && !children.includes('\n')
      ? fileReference(children)
      : null;
    return file
      ? <button type="button" className="session-markdown-file font-mono" onClick={() => openFile?.(file)}>{children}</button>
      : <code className={className} {...props}>{children}</code>;
  },
  a: function MarkdownLink({ node: _node, href = '', children, ...props }) {
    const openFile = useContext(OpenFile);
    const file = fileReference(href);
    const label = <InsideLink.Provider value>{children}</InsideLink.Provider>;
    if (file) {
      return openFile
        ? <button type="button" className="session-markdown-file" onClick={() => openFile(file)}>{label}</button>
        : label;
    }
    if (!href) return label;
    return <a {...props} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer noopener">{label}</a>;
  },
};

export function SessionMarkdown({ text, openFile, passive }: { text: string; openFile?: (file: FileTarget) => void; passive?: boolean }) {
  return (
    <div className="session-markdown min-w-0">
      <OpenFile.Provider value={openFile}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          disallowedElements={passive ? ['a', 'img'] : undefined}
          unwrapDisallowed={passive}
          components={components}
          urlTransform={(url, key) => key === 'href' && fileReference(url) ? url : defaultUrlTransform(url)}
        >
          {text}
        </Markdown>
      </OpenFile.Provider>
    </div>
  );
}
