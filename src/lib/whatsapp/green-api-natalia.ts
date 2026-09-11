// Green API инстанс Наташи (WhatsApp Business, используется для сторис) —
// отдельный номер и токен от основного инстанса Даши (см. ./green-api.ts).
// Держим отдельным файлом, чтобы не перепутать инстансы: отправка сторис не
// должна случайно уйти на основной рабочий номер.
import axios from 'axios';

const BASE = 'https://api.green-api.com';

function url(method: string) {
  return `${BASE}/waInstance${process.env.GREENAPI_NATALIA_ID_INSTANCE}/${method}/${process.env.GREENAPI_NATALIA_API_TOKEN}`;
}

export async function getInstanceStateNatalia(): Promise<string> {
  const res = await axios.get(url('getStateInstance'));
  return res.data?.stateInstance || 'unknown';
}

/**
 * Грузит файл напрямую в Green API (метод UploadFile) и возвращает ссылку
 * urlFile, готовую для sendMediaStatus. Своего облачного хранилища заводить
 * не нужно — но у ссылки Green API есть срок жизни ~15 дней с момента
 * загрузки, поэтому грузим файл в момент постановки в очередь, а не в
 * момент фактической отправки (см. story-dispatch.ts про проверку протухания).
 */
export async function uploadFileNatalia(fileBuffer: Buffer, fileName: string, contentType: string): Promise<string> {
  const res = await axios.post(url('uploadFile'), fileBuffer, {
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'GreenAPI-File-Name': fileName,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (!res.data?.urlFile) throw new Error('Green API не вернул urlFile при загрузке');
  return res.data.urlFile as string;
}

export async function sendMediaStatusNatalia(urlFile: string, fileName: string, caption: string) {
  const res = await axios.post(url('sendMediaStatus'), {
    urlFile,
    fileName,
    caption: caption?.slice(0, 1024) || undefined,
  });
  return res.data;
}

export async function sendTextStatusNatalia(message: string) {
  const res = await axios.post(url('sendTextStatus'), { message });
  return res.data;
}
