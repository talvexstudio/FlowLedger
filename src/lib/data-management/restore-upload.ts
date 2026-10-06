import { RestoreError } from './restore-errors';

export const MAX_RESTORE_FILE_BYTES = 25 * 1024 * 1024;

export type RestoreUpload = {
  json: string;
  formData: FormData;
};

export const readRestoreUpload = async (request: Request): Promise<RestoreUpload> => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new RestoreError('INVALID_BACKUP', 'Upload a FlowLedger JSON backup file.');
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    throw new RestoreError('INVALID_BACKUP', 'The backup upload could not be read.', { cause: error });
  }

  const value = formData.get('file');
  if (!value || typeof value === 'string' || typeof value.text !== 'function') {
    throw new RestoreError('INVALID_BACKUP', 'Choose a FlowLedger JSON backup file.');
  }
  const file = value as File;
  if (!file.name.toLowerCase().endsWith('.json')) {
    throw new RestoreError('INVALID_BACKUP', 'The selected backup must be a JSON file.');
  }
  if (file.size > MAX_RESTORE_FILE_BYTES) {
    throw new RestoreError('INVALID_BACKUP', 'The selected backup exceeds the 25 MB restore limit.');
  }
  const acceptedTypes = ['', 'application/json', 'text/json', 'application/octet-stream'];
  if (!acceptedTypes.includes(file.type.toLowerCase())) {
    throw new RestoreError('INVALID_BACKUP', 'The selected backup must be a JSON file.');
  }

  return { json: await file.text(), formData };
};
