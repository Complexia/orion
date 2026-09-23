import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { stepLightboxIndex, useImageLightbox } from '../src/app/imageLightbox';

// Arrow navigation wraps around the gallery in both directions.
assert.equal(stepLightboxIndex(0, 1, 3), 1);
assert.equal(stepLightboxIndex(2, 1, 3), 0, 'next from the last image wraps to the first');
assert.equal(stepLightboxIndex(0, -1, 3), 2, 'previous from the first image wraps to the last');
assert.equal(stepLightboxIndex(0, 1, 1), 0, 'a single image never moves');
assert.equal(stepLightboxIndex(0, -1, 0), 0, 'an empty gallery is a no-op');

// The store opens a gallery at the clicked image, steps through it, and closes.
const images = [
  { src: 'orion-attachment://local/image?path=%2Ftmp%2Fone.png', alt: 'one' },
  { src: 'orion-attachment://local/image?path=%2Ftmp%2Ftwo.png', alt: 'two' },
];
useImageLightbox.getState().open(images, 1);
assert.equal(useImageLightbox.getState().index, 1);
useImageLightbox.getState().step(1);
assert.equal(useImageLightbox.getState().index, 0, 'stepping past the end wraps');
useImageLightbox.getState().close();
assert.deepEqual(useImageLightbox.getState().images, []);
assert.equal(useImageLightbox.getState().index, 0);

// Every inline image render site must opt into the viewer, and the transcript
// must define the scope the arrow keys page through.
const [markdownSource, attachmentsSource, chatSource, appSource] = await Promise.all([
  readFile(new URL('../src/app/markdown.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/attachments.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/chat.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
]);
assert.match(markdownSource, /className="markdown-media"[\s\S]*?data-lightbox=""[\s\S]*?onClick=\{handleLightboxImageClick\}/);
assert.match(attachmentsSource, /alt=\{attachment\.name\}[\s\S]*?data-lightbox=""[\s\S]*?onClick=\{handleLightboxImageClick\}/);
assert.match(chatSource, /className="chat-scroll"[\s\S]*?data-lightbox-scope=""/);
assert.match(appSource, /<ImageLightbox \/>/, 'the viewer must be mounted once at the app root');

console.log('image lightbox tests passed');
