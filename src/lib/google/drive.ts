import { google } from 'googleapis';
import { getGoogleAuthClient } from './auth';
import { getPhotosFolderUrl } from '../post-meta/emoji';

export async function getGoogleDriveClient() {
  const auth = await getGoogleAuthClient();
  return google.drive({ version: 'v3', auth });
}

/** ID папки Drive с фотографиями проекта. Ссылка живёт в нашей базе
    (страница «Проекты»), раньше лежала в листе PROJECT_MEDIA. */
export async function getProjectPhotoFolderId(projectName: string): Promise<string> {
  const url = await getPhotosFolderUrl(projectName);
  if (!url) {
    throw new Error(
      `Не задана папка с фото для проекта «${projectName}» — добавьте ссылку на странице «Проекты»`,
    );
  }

  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Не разобрать ID папки из ссылки: ${url}`);
  return match[1];
}

export async function getDriveImageUrls(folderId: string, limit = 5): Promise<string[]> {
  const drive = await getGoogleDriveClient();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp') and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: limit,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  return files.filter(f => f.id).map(f => `https://drive.google.com/uc?export=view&id=${f.id}`);
}

// Downscale + recompress an image so uploads to Telegram stay small and fast.
// Telegram shows photos at ~1280px anyway; source real-estate photos can be 3–10 MB.
export async function compressImageBuffer(buffer: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer)
      .rotate() // respect EXIF orientation
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return buffer; // on any failure, fall back to the original
  }
}

export async function getDriveImages(folderId: string, limit = 5): Promise<Buffer[]> {
  const drive = await getGoogleDriveClient();
  
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp') and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: limit,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  if (files.length === 0) return [];

  // Параллельно: последовательное скачивание пяти фото съедало секунды из
  // 60-секундного лимита функции отправки.
  const buffers = await Promise.all(
    files.filter(f => f.id).map(async file => {
      const fileRes = await drive.files.get(
        { fileId: file.id!, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      return compressImageBuffer(Buffer.from(fileRes.data as ArrayBuffer));
    })
  );

  return buffers;
}

export async function uploadCatalogCover(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const drive = await getGoogleDriveClient();

  const folderId = '11MjObMKaTuRTY2-ivhy7R0caut-b7yRK';

  // Check for existing file with same name
  let existingFileId: string | null = null;
  try {
    const existing = await drive.files.list({
      q: `'${folderId}' in parents and name='${fileName}' and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    existingFileId = existing.data.files?.[0]?.id ?? null;
  } catch (e: any) {
    throw new Error(`[list] ${e.message}`);
  }

  let fileId: string;
  const { Readable } = await import('stream');
  const stream = Readable.from(fileBuffer);

  if (existingFileId) {
    try {
      const updated = await drive.files.update({
        fileId: existingFileId,
        media: { mimeType, body: stream },
        fields: 'id',
        supportsAllDrives: true,
      });
      fileId = updated.data.id!;
    } catch (e: any) {
      throw new Error(`[update] ${e.message}`);
    }
  } else {
    try {
      const uploaded = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType, body: stream },
        fields: 'id',
        supportsAllDrives: true,
      });
      fileId = uploaded.data.id!;
    } catch (e: any) {
      throw new Error(`[create] ${e.message}`);
    }
  }

  // Attempt to set public permissions (may be skipped if domain policy restricts it;
  // files inherit access from the parent folder's sharing settings)
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
  } catch {}

  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

// ── WA QUEUE ─────────────────────────────────────────────────────────────────

let _waQueueFolderId: string | null = null;

async function findOrCreateWaQueueFolder(): Promise<string> {
  if (_waQueueFolderId) return _waQueueFolderId;

  const drive = await getGoogleDriveClient();

  const res = await drive.files.list({
    q: `name='WA_Queue' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });

  if (res.data.files?.[0]?.id) {
    _waQueueFolderId = res.data.files[0].id;
    return _waQueueFolderId;
  }

  const folder = await drive.files.create({
    requestBody: { name: 'WA_Queue', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });

  _waQueueFolderId = folder.data.id!;

  try {
    await drive.permissions.create({
      fileId: _waQueueFolderId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch {}

  return _waQueueFolderId;
}

export async function uploadToWaQueue(buffer: Buffer, filename: string, mimeType = 'image/jpeg'): Promise<string> {
  const drive = await getGoogleDriveClient();
  const folderId = await findOrCreateWaQueueFolder();
  const { Readable } = await import('stream');

  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });

  const fileId = file.data.id!;

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch {}

  return fileId;
}

export async function downloadFromDrive(fileId: string): Promise<Buffer> {
  const drive = await getGoogleDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// TODO: cache photo IDs

export async function findC3SlideByUnit(unit: string): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_C3_SLIDES_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_C3_SLIDES_FOLDER_ID not configured');

  const drive = await getGoogleDriveClient();
  
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp') and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  if (files.length === 0) throw new Error('No slide images found in C3 folder');

  const targetName = String(unit).toLowerCase().trim();

  const matchedFile = files.find(f => {
    if (!f.name) return false;
    const nameWithoutExt = f.name.replace(/\.[^/.]+$/, '').toLowerCase().trim();
    return nameWithoutExt === targetName;
  });

  if (!matchedFile || !matchedFile.id) {
    throw new Error(`Slide image not found for unit: ${unit}`);
  }

  const fileRes = await drive.files.get(
    { fileId: matchedFile.id, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  
  const buffer = Buffer.from(fileRes.data as ArrayBuffer);
  let mimeType = 'image/jpeg';
  if (matchedFile.name?.toLowerCase().endsWith('.png')) mimeType = 'image/png';
  if (matchedFile.name?.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
  
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
