// iOS ignores `touch-action: none` inside an iframe (ad networks, the Playbox preview): the first
// finger move pans the host page and ends the pointer stream with `pointercancel`, so pointer-only
// drags die. Only touchmove is cancelled: touchstart stays, so taps keep `click`.
// `data-touch-native` matches the guard in the plbx-playables-skills templates.
export const TOUCH_GUARD_SCRIPT = `(function(){
var native='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-touch-native]';
function scrolls(el){
for(;el&&el.nodeType===1&&el!==document.body&&el!==document.documentElement;el=el.parentElement){
var s=getComputedStyle(el);
if(((s.overflowY==='auto'||s.overflowY==='scroll')&&el.scrollHeight>el.clientHeight+1)||((s.overflowX==='auto'||s.overflowX==='scroll')&&el.scrollWidth>el.clientWidth+1))return true;
}
return false;
}
document.addEventListener('touchmove',function(e){
var t=e.target;
if(!e.cancelable)return;
if(!(t&&t.tagName==='CANVAS')&&((t&&t.closest&&t.closest(native))||scrolls(t)))return;
e.preventDefault();
},{passive:false});
})();`
