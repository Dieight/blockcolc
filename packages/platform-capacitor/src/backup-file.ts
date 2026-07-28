import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isCapacitorNative } from './notification-port';

/** Writes a local JSON backup and hands it to the platform's Files/share surface. */
export async function saveNativeBackupFile(fileName: string, contents: string): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  const written = await Filesystem.writeFile({
    path: fileName,
    data: contents,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const available = await Share.canShare();
  if (!available.value) throw new Error('This device cannot share a local backup file');
  await Share.share({
    title: '导出番茄钟存档',
    files: [written.uri],
  });
  return true;
}
