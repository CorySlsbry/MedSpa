/**
 * Inline script that reads the user's theme preference from localStorage
 * and applies it to <html data-theme="..."> BEFORE React hydration runs.
 * Prevents a flash of the default Aesthera theme on hard reload when the
 * user has chosen Glass.
 *
 * Server component — emits a synchronous <script> at the top of the shell
 * tree. Browsers execute it during HTML parsing, so the attribute is set
 * before any styled content paints.
 *
 * Per-scope: admin shell mounts with scope="admin" (reads
 * `aesthera-theme-admin`), tenant shell mounts with scope="tenant" (reads
 * `aesthera-theme-tenant`). Two keys keep the layers' preferences
 * independent.
 */
export default function ThemePrePaintScript({ scope }: { scope: "admin" | "tenant" }) {
  const key = `aesthera-theme-${scope}`;
  // We intentionally read scope into a variable inside the IIFE so the
  // localStorage lookup is straight-line and small. The script must be
  // self-contained — no module imports during HTML parsing.
  const code = `(function(){try{var t=window.localStorage.getItem(${JSON.stringify(
    key,
  )});if(t==="glass"||t==="aesthera"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
