// Image picker used by commercial-proposal items: paste a URL, drag a file
// in, hit Ctrl+V, or browse for one.
//
// Everything that comes in as a file/blob is normalised to a JPEG data URI
// through a canvas. That does two jobs at once: it caps the stored size
// (renders straight off a phone are multi-megabyte, and the app keeps images
// as data URIs in Postgres), and it converts WEBP — which PDFKit can't
// embed — into something the proposal PDF can actually draw.
//
// A pasted http(s) URL that a canvas can't read because of CORS is kept
// as-is; the PDF renderer fetches those server-side at render time.

const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.82;

function normalizeFromSource(source, { revoke } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        // JPEG has no alpha — paint white first so transparent PNGs don't
        // come out with black edges.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      } catch (e) {
        reject(e);
      } finally {
        if (revoke) URL.revokeObjectURL(source);
      }
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(source);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = source;
  });
}

export async function fileToDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Это не изображение');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Файл слишком большой — максимум 12 МБ');
  }
  return normalizeFromSource(URL.createObjectURL(file), { revoke: true });
}

// Returns a data URI when the image is readable cross-origin, otherwise the
// original URL (still perfectly usable — the browser shows it and the PDF
// renderer fetches it).
export async function urlToDataUrl(url) {
  try {
    return await normalizeFromSource(url);
  } catch {
    return url;
  }
}

export function renderImagePicker(id, value) {
  const hasValue = !!value;
  return `
    <div class="image-picker" data-picker="${id}">
      <div class="image-picker__url">
        <i class="fa-solid fa-link"></i>
        <input type="text" class="image-picker__url-input" placeholder="Введите адрес изображения" value="" autocomplete="off" />
        <button type="button" class="btn btn--sm image-picker__url-cancel">Отменить</button>
      </div>
      ${hasValue ? `
        <div class="image-picker__preview">
          <img src="${value.replace(/"/g, '&quot;')}" alt="" />
          <div class="image-picker__preview-actions">
            <button type="button" class="btn btn--sm image-picker__replace">Заменить</button>
            <button type="button" class="btn btn--sm btn--danger-ghost image-picker__remove">Удалить</button>
          </div>
        </div>
      ` : `
        <div class="image-picker__drop" tabindex="0">
          <div class="image-picker__hint">
            Перетащите изображение сюда<br />или вставьте с помощью Ctrl+V
          </div>
          <button type="button" class="btn btn--primary image-picker__browse">Выбрать файл</button>
        </div>
      `}
      <input type="file" class="image-picker__file" accept="image/jpeg,image/jpg,image/png,image/webp" hidden />
      <div class="image-picker__status" hidden></div>
    </div>
  `;
}

// onChange(dataUrlOrUrl | null) fires whenever the picture changes.
export function attachImagePicker(root, id, onChange) {
  const el = root.querySelector(`[data-picker="${id}"]`);
  if (!el) return;

  const fileInput = el.querySelector('.image-picker__file');
  const dropZone = el.querySelector('.image-picker__drop');
  const urlInput = el.querySelector('.image-picker__url-input');
  const status = el.querySelector('.image-picker__status');

  const setStatus = (text, isError) => {
    status.hidden = !text;
    status.textContent = text || '';
    status.classList.toggle('is-error', !!isError);
  };

  const accept = async (promise) => {
    setStatus('Обработка изображения...', false);
    try {
      const result = await promise;
      setStatus('', false);
      onChange(result);
    } catch (e) {
      setStatus(e.message || 'Не удалось загрузить изображение', true);
    }
  };

  el.querySelector('.image-picker__browse')?.addEventListener('click', () => fileInput.click());
  el.querySelector('.image-picker__replace')?.addEventListener('click', () => fileInput.click());
  el.querySelector('.image-picker__remove')?.addEventListener('click', () => onChange(null));

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) accept(fileToDataUrl(file));
  });

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('is-dragover'));
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        accept(fileToDataUrl(file));
        return;
      }
      // Dragging an image out of another browser tab hands over a URL
      // rather than a file.
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
      if (text) accept(urlToDataUrl(text.trim()));
    });
  }

  // Ctrl+V: the paste event only reaches an element when it has focus, so
  // listen on the document and route it to whichever picker the user is
  // actually pointing at or focused on.
  const onPaste = (e) => {
    const active = el.contains(document.activeElement) || el.matches(':hover') || el.querySelector(':hover');
    if (!active) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) accept(fileToDataUrl(file));
      return;
    }
    const text = e.clipboardData?.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) {
      e.preventDefault();
      accept(urlToDataUrl(text.trim()));
    }
  };
  document.addEventListener('paste', onPaste);
  // The view re-renders by replacing innerHTML, which drops the element but
  // not this document-level listener — so tie its lifetime to the element.
  const observer = new MutationObserver(() => {
    if (!document.contains(el)) {
      document.removeEventListener('paste', onPaste);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const applyUrl = () => {
    const value = urlInput.value.trim();
    if (!value) return;
    accept(urlToDataUrl(value));
    urlInput.value = '';
  };
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyUrl();
    }
  });
  urlInput.addEventListener('blur', () => {
    if (urlInput.value.trim()) applyUrl();
  });
  el.querySelector('.image-picker__url-cancel')?.addEventListener('click', () => {
    urlInput.value = '';
    setStatus('', false);
  });
}
