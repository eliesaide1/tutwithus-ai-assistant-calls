import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import yauzl from 'yauzl';
import { ApiError } from '../../http/errors.js';

export const MAX_KNOWLEDGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 500_000;
const MAX_DOCX_ENTRIES = 256;
const MAX_DOCX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const CHUNK_CHARACTER_LIMIT = 3_500;

export type UploadedKnowledgeFile = {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
};

export type ParsedKnowledgeFile = {
  originalName: string;
  mimeType: string;
  text: string;
  sizeBytes: number;
};

function safeOriginalName(value: string): string {
  return Array.from(path.basename(path.win32.basename(value)))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 180);
}

async function validateDocxArchive(buffer: Buffer): Promise<void> {
  let archive: yauzl.ZipFile;
  try {
    archive = await yauzl.fromBufferPromise(buffer, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new ApiError(
      422,
      'DOCUMENT_PARSE_FAILED',
      'The Word document could not be read.',
    );
  }

  let entryCount = 0;
  let declaredUncompressedBytes = 0;
  let actualUncompressedBytes = 0;
  let containsMainDocument = false;
  try {
    for await (const entry of archive.eachEntry()) {
      entryCount += 1;
      declaredUncompressedBytes += entry.uncompressedSize;
      if (
        entryCount > MAX_DOCX_ENTRIES ||
        declaredUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES
      ) {
        throw new ApiError(
          413,
          'DOCUMENT_EXPANSION_LIMIT',
          'The Word document expands beyond the supported size limit.',
        );
      }
      if (entry.isEncrypted()) {
        throw new ApiError(
          415,
          'DOCUMENT_TYPE_UNSUPPORTED',
          'Encrypted Word documents are not supported.',
        );
      }
      if (entry.fileName === 'word/document.xml') {
        containsMainDocument = true;
      }

      const stream = await archive.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        actualUncompressedBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk);
        if (actualUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
          stream.destroy();
          throw new ApiError(
            413,
            'DOCUMENT_EXPANSION_LIMIT',
            'The Word document expands beyond the supported size limit.',
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      422,
      'DOCUMENT_PARSE_FAILED',
      'The Word document could not be read.',
    );
  } finally {
    archive.close();
  }

  if (!containsMainDocument) {
    throw new ApiError(
      422,
      'DOCUMENT_PARSE_FAILED',
      'The Word document could not be read.',
    );
  }
}

export async function extractKnowledgeText(
  file: UploadedKnowledgeFile,
): Promise<ParsedKnowledgeFile> {
  if (
    file.buffer.length === 0 ||
    file.buffer.length > MAX_KNOWLEDGE_FILE_BYTES
  ) {
    throw new ApiError(
      413,
      'DOCUMENT_SIZE_INVALID',
      'The file must be smaller than 8 MB.',
    );
  }

  const originalName = safeOriginalName(file.originalName);
  const extension = path.extname(originalName).toLowerCase();
  let text: string;

  if (
    extension === '.pdf' &&
    file.mimeType === 'application/pdf' &&
    file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) {
    const parser = new PDFParse({
      data: new Uint8Array(file.buffer),
      isEvalSupported: false,
      disableFontFace: true,
      maxImageSize: 1_000_000,
    });
    try {
      const result = await parser.getText();
      text = result.text;
    } catch {
      throw new ApiError(
        422,
        'DOCUMENT_PARSE_FAILED',
        'The PDF could not be read.',
      );
    } finally {
      await parser.destroy();
    }
  } else if (
    extension === '.docx' &&
    file.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b
  ) {
    await validateDocxArchive(file.buffer);
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } catch {
      throw new ApiError(
        422,
        'DOCUMENT_PARSE_FAILED',
        'The Word document could not be read.',
      );
    }
  } else if (
    extension === '.txt' &&
    file.mimeType === 'text/plain' &&
    !file.buffer.includes(0)
  ) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new ApiError(
        422,
        'DOCUMENT_ENCODING_INVALID',
        'Text files must use UTF-8 encoding.',
      );
    }
  } else {
    throw new ApiError(
      415,
      'DOCUMENT_TYPE_UNSUPPORTED',
      'Upload a PDF, DOCX, or UTF-8 TXT file with matching file content.',
    );
  }

  const normalizedText = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  if (normalizedText.length === 0) {
    throw new ApiError(
      422,
      'DOCUMENT_EMPTY',
      'No readable text was found in the document.',
    );
  }
  if (normalizedText.length > MAX_EXTRACTED_CHARACTERS) {
    throw new ApiError(
      413,
      'DOCUMENT_TEXT_TOO_LARGE',
      'The extracted document text exceeds the 500,000 character limit.',
    );
  }

  return {
    originalName,
    mimeType: file.mimeType,
    text: normalizedText,
    sizeBytes: file.buffer.length,
  };
}

export function splitKnowledgeText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > CHUNK_CHARACTER_LIMIT) {
    let splitAt = remaining.lastIndexOf('\n', CHUNK_CHARACTER_LIMIT);
    if (splitAt < CHUNK_CHARACTER_LIMIT / 2) {
      splitAt = remaining.lastIndexOf(' ', CHUNK_CHARACTER_LIMIT);
    }
    if (splitAt < CHUNK_CHARACTER_LIMIT / 2) {
      splitAt = CHUNK_CHARACTER_LIMIT;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}
