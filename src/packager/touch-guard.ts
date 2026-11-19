// iOS ignores `touch-action: none` inside an iframe (ad networks, the Playbox preview): the
// first finger move pans the host page and ends the pointer stream with `pointercancel`, so
// pointer-only drags die. Only touchmove is cancelled: touchstart stays, so taps keep `click`.
export const TOUCH_GUARD_SCRIPT = `(function(){
var native='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-plbx-native-touch]';
function scrolls(el){
for(;el&&el.nodeType===1&&el!==document.body&&el!==document.documentElement;el=el.parentElement){
var o=getComputedStyle(el).overflowY;
if((o==='auto'||o==='scroll')&&el.scrollHeight>el.clientHeight)return true;
}
return false;
}
document.addEventListener('touchmove',function(e){
var t=e.target;
if(!e.cancelable||(t&&t.closest&&t.closest(native))||scrolls(t))return;
e.preventDefault();
},{passive:false});
})();`
