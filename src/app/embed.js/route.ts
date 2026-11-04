/**
 * GET /embed.js
 *
 * Auto-injecting iframe loader. A clinic drops:
 *
 *   <script
 *     src="https://aesthera.io/embed.js"
 *     data-clinic="your-clinic-slug"
 *     data-theme="light"
 *     defer></script>
 *   <div id="aesthera-book"></div>
 *
 * On load, the script finds the target element (defaults to
 * #aesthera-book) and injects a same-domain iframe pointing at
 * /embed/{slug}/book. The iframe auto-resizes to its content via
 * postMessage (height messages handled below).
 *
 * No external dependencies, no React, no analytics — vanilla JS that
 * works in any modern browser. Cached for 1 hour.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SCRIPT = `(function(){
  if (typeof window === 'undefined' || !window.document) return;
  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if ((scripts[i].src || '').indexOf('embed.js') !== -1) { script = scripts[i]; break; }
    }
  }
  if (!script) return;
  var slug = script.getAttribute('data-clinic') || script.getAttribute('data-slug');
  if (!slug) {
    console.error('[aesthera] data-clinic attribute is required');
    return;
  }
  var targetId = script.getAttribute('data-target') || 'aesthera-book';
  var origin = (script.src.indexOf('http') === 0) ? script.src.replace(/\\/embed\\.js.*/, '') : window.location.origin;

  function mount() {
    var target = document.getElementById(targetId);
    if (!target) {
      console.error('[aesthera] target #' + targetId + ' not found');
      return;
    }
    while (target.firstChild) target.removeChild(target.firstChild);
    var iframe = document.createElement('iframe');
    iframe.src = origin + '/embed/' + encodeURIComponent(slug) + '/book';
    iframe.style.width = '100%';
    iframe.style.minHeight = '720px';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Book an appointment');
    iframe.setAttribute('allow', 'payment');
    target.appendChild(iframe);

    window.addEventListener('message', function(ev){
      if (!ev.data || ev.data.source !== 'aesthera-embed') return;
      if (ev.data.type === 'resize' && typeof ev.data.height === 'number') {
        iframe.style.height = Math.max(720, ev.data.height) + 'px';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();`;

export async function GET() {
  return new NextResponse(SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
