import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ThemeBoot, ThemeToaster } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";

/**
 * Runs in <head> before the body is parsed. Paints a cached name, restores a
 * cookie session, and — on the first click, before React hydrates — opens
 * Google with a nonce and starts reading the popup handoff. No auth library.
 */
const BOOT_SCRIPT = `(function(){
  var ACCOUNT="readtube.account";
  var BEARER="grok-auth.bearer-token";
  var AT="readtube.account-at";
  var PENDING="readtube.pending-nonce";
  function paint(label, email){
    var root=document.documentElement;
    root.dataset.account="in";
    root.style.setProperty("--account-label",JSON.stringify(label||"Account"));
    root.style.setProperty("--account-initial",JSON.stringify((label||"A").charAt(0).toUpperCase()));
    if(arguments.length>1) root.style.setProperty("--account-email",JSON.stringify(email||""));
  }
  function storeAccount(account){
    try{
      localStorage.setItem(ACCOUNT,JSON.stringify(account));
      sessionStorage.setItem(AT,String(Date.now()));
    }catch(e){}
    paint(account.displayName||account.primaryEmail||"Account", account.primaryEmail||"");
    try{window.dispatchEvent(new Event("readtube-auth"));}catch(e){}
  }
  try{
    var raw=localStorage.getItem(ACCOUNT);
    if(raw){var a=JSON.parse(raw);paint(a.displayName||a.primaryEmail||"Account", a.primaryEmail||"");}
  }catch(e){}
  function apply(msg){
    if(!msg||msg.source!=="grok-auth-popup"||!msg.token)return;
    try{
      sessionStorage.setItem(BEARER,msg.token);
      localStorage.setItem(BEARER,msg.token);
    }catch(e){}
    if(msg.user&&(msg.user.name||msg.user.email||msg.user.image)){
      storeAccount({displayName:msg.user.name||null,primaryEmail:msg.user.email||null,profileImageUrl:msg.user.image||null});
    }else{
      try{if(!localStorage.getItem(ACCOUNT))storeAccount({displayName:"Account",primaryEmail:null,profileImageUrl:null});
      else{sessionStorage.setItem(AT,String(Date.now()));var existing=JSON.parse(localStorage.getItem(ACCOUNT)||"{}");paint(existing.displayName||existing.primaryEmail||"Account", existing.primaryEmail||"");window.dispatchEvent(new Event("readtube-auth"));}}catch(e){}
    }
  }
  window.addEventListener("message",function(e){
    if(e.origin!==location.origin)return;
    apply(e.data);
  });
  try{
    var bc=new BroadcastChannel("readtube-auth-popup");
    bc.onmessage=function(e){apply(e.data);};
  }catch(e){}
  var pollNonce="";
  var pollTimer=0;
  var pollStarted=0;
  function poll(nonce){
    if(!nonce||nonce===pollNonce)return;
    pollNonce=nonce;
    pollStarted=Date.now();
    if(pollTimer)clearTimeout(pollTimer);
    var saw=0;
    function again(){
      if(pollNonce!==nonce)return;
      if(Date.now()-pollStarted>180000){pollNonce="";return;}
      pollTimer=setTimeout(tick,200);
    }
    function tick(){
      if(pollNonce!==nonce)return;
      fetch("/auth/popup?claim="+encodeURIComponent(nonce),{credentials:"include",cache:"no-store"})
        .then(function(r){return r.ok?r.json():null;})
        .then(function(data){
          if(pollNonce!==nonce)return;
          if(data&&data.token){
            apply({source:"grok-auth-popup",token:data.token,user:data.user||null});
            var named=data.user&&(data.user.name||data.user.email||data.user.image);
            if(!saw)saw=Date.now();
            if(named||Date.now()-saw>4000){
              pollNonce="";
              try{sessionStorage.removeItem(PENDING);}catch(e){}
              return;
            }
          }
          again();
        })
        .catch(function(){again();});
    }
    tick();
  }
  function stamp(anchor, force){
    var nonce=anchor.getAttribute("data-nonce");
    var at=Number(anchor.getAttribute("data-nonce-at")||0);
    if(force||!nonce||Date.now()-at>1000){
      nonce=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():(Date.now().toString(16)+Math.random().toString(16).slice(2));
      var base=anchor.getAttribute("data-base")||anchor.getAttribute("href");
      var url=new URL(base,location.href);
      url.searchParams.set("nonce",nonce);
      anchor.href=url.pathname+url.search;
      anchor.target="_blank";
      anchor.rel="opener";
      anchor.setAttribute("data-nonce",nonce);
      anchor.setAttribute("data-nonce-at",String(Date.now()));
    }
    return anchor.getAttribute("data-nonce");
  }
  document.addEventListener("pointerdown",function(event){
    if(event.button!==0)return;
    var node=event.target;
    var anchor=node&&node.closest?node.closest("a[data-provider]"):null;
    if(!anchor)return;
    stamp(anchor,true);
  },true);
  document.addEventListener("click",function(event){
    var node=event.target;
    var anchor=node&&node.closest?node.closest("a[data-provider]"):null;
    if(!anchor)return;
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    var nonce=stamp(anchor,false);
    // Open during the click, before hydration can replace the link and drop
    // its default action. No window features: a feature string is what the
    // popup blocker treats as a second-tap popup. If this returns null, the
    // anchor still navigates.
    var popup=null;
    try{popup=window.open(anchor.href,"_blank");}catch(e){}
    if(popup)event.preventDefault();
    try{sessionStorage.setItem(PENDING,JSON.stringify({nonce:nonce,at:Date.now()}));}catch(e){}
    poll(nonce);
  },true);
  try{
    var pending=sessionStorage.getItem(PENDING);
    if(pending){var parsed=JSON.parse(pending);if(parsed&&parsed.nonce&&Date.now()-parsed.at<180000)poll(parsed.nonce);}
  }catch(e){}
  var headers={accept:"application/json"};
  try{var token=sessionStorage.getItem(BEARER)||localStorage.getItem(BEARER);if(token)headers.authorization="Bearer "+token;}catch(e){}
  fetch("/api/auth/get-session",{credentials:"include",headers:headers,cache:"no-store"}).then(function(r){return r.ok?r.json():undefined;}).then(function(data){
    var user=data&&data.user;
    if(!user)return;
    storeAccount({displayName:user.name||null,primaryEmail:user.email||null,profileImageUrl:user.image||null});
  }).catch(function(){});
})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ReadTube — Video as books" },
      {
        name: "description",
        content:
          "Turn a YouTube video into a cleaned transcript.",
      },
      { name: "theme-color", content: "#0a0a0b" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" data-theme="dark" className="dark antialiased" suppressHydrationWarning>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html:
              '.auth-known-in{display:none}html[data-account="in"] .auth-known-out{display:none}html[data-account="in"] .auth-known-in{display:flex}.login-in{display:none}html[data-account="in"] .login-out{display:none}html[data-account="in"] .login-in{display:block}[data-account-name]::before{content:var(--account-label,"")}[data-account-email]::before{content:var(--account-email,"")}[data-account-initial]::before{content:var(--account-initial,"")}',
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: BOOT_SCRIPT,
          }}
        />
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("readtube.theme");if(t==="light"){document.documentElement.dataset.theme="light";document.documentElement.classList.add("light");document.documentElement.classList.remove("dark");}}catch(e){}try{var f=localStorage.getItem("readtube.font");if(f==="sm"||f==="lg")document.documentElement.dataset.font=f;}catch(e){}try{var l=document.createElement("link");l.rel="stylesheet";l.href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap";l.media="print";l.onload=function(){this.media="all"};document.head.appendChild(l);}catch(e){}',
          }}
        />
        <PreviewHostBridge />
        <ThemeBoot />
        <AuthProvider>
          <TooltipProvider delayDuration={250}>
            <Outlet />
            <ThemeToaster />
          </TooltipProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
