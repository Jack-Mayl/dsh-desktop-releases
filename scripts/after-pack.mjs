import { join } from 'node:path'
import { rcedit } from 'rcedit'

/**
 * Stamp the official Harness icon without enabling electron-builder's
 * winCodeSign pipeline. `signAndEditExecutable: false` is required on this
 * machine because winCodeSign's archive needs Windows symlink privilege, but
 * it also skips the ordinary icon edit. This hook restores only that edit.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const executable = join(context.appOutDir, `${context.packager.appInfo.productName}.exe`)
  const icon = join(context.packager.projectDir, 'build', 'icon.ico')
  await rcedit(executable, { icon })
  console.log(`Stamped official icon: ${executable}`)
}
