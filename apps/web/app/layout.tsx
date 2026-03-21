import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clawer",
  description: "Real-time AI Agent Conversation Demo",
};

// Script to remove browser-extension-injected attributes before React hydration
// This runs synchronously before React attaches, preventing hydration mismatches
const cleanupExtensionsScript = `
(function(){
  var b = document.body;
  if(!b) return;
  var attrs = b.attributes;
  for(var i = attrs.length - 1; i >= 0; i--){
    var n = attrs[i].name;
    if(n.startsWith('data-atm-') || n.startsWith('data-ls-') || n === 'cz-shortcut-listen' || n === 'data-new-gr-c-s-check-loaded' || n === 'data-gr-ext-installed'){
      b.removeAttribute(n);
    }
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: cleanupExtensionsScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
