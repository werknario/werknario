/** Our extension's routing identity. Fixed in code per the spec — everything
 * else (displayName, description, engine) is read from the packaged
 * manifest at startup so it never drifts from what we actually ship. */
export const OUR_PUBLISHER = "xconcapps";
export const OUR_EXTENSION_NAME = "werknario-webide-agent";
export const OUR_VERSION = "0.1.0";
export const OUR_FULL_ID = `${OUR_PUBLISHER}.${OUR_EXTENSION_NAME}`;
export const OUR_EXTENSION_ID = "00000000-0000-4000-8000-werknario0001";
export const OUR_VSIX_FILENAME = `${OUR_EXTENSION_NAME}-web-${OUR_VERSION}.vsix`;

/** Static per spec — no Date.now()/new Date() so the injected object stays
 * byte-for-byte deterministic across requests and test runs. */
export const OUR_LAST_UPDATED = "2026-07-16T00:00:00.000Z";

/** True if the given gallery route params (publisher/name) refer to our
 * extension, case-insensitively. */
export function isOurs(publisher: string, name: string): boolean {
  return (
    publisher.toLowerCase() === OUR_PUBLISHER.toLowerCase() &&
    name.toLowerCase() === OUR_EXTENSION_NAME.toLowerCase()
  );
}
