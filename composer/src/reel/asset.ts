import { staticFile } from "remotion";

/** Where to load a media file from. Links (http, data, blob, site-relative) are used as they are;
 *  a bare name is a file bundled in `public/`. */
export const resolveAsset = (src: string): string => (/^(https?:|data:|blob:|\/)/i.test(src) ? src : staticFile(src));
