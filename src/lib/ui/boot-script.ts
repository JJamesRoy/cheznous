/**
 * Inline script run in <head> before first paint. Applies saved preferences
 * to <html> so there is no flash: theme (`cn-theme`), privacy mode
 * (`cn-privacy`) and the collapsed desktop sidebar (`cn-sidebar`).
 * Keep it tiny and dependency-free; it is serialized as a string.
 */
export const THEME_COLORS = { light: "#f1f2ef", dark: "#0b0b0b" } as const;

export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=localStorage;var t=s.getItem('cn-theme');if(t==='light'||t==='dark'){d.setAttribute('data-theme',t);var c=t==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',c)})}if(s.getItem('cn-privacy')==='on')d.setAttribute('data-privacy','on');if(s.getItem('cn-sidebar')==='collapsed')d.setAttribute('data-sidebar','collapsed')}catch(e){}})();`;
