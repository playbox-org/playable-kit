// Minimal engine-less playable: draws on canvas, routes CTA through the
// plbx/super_html channel when the packager injected it, else window.open.
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#123456';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  document.getElementById('cta').addEventListener('click', function () {
    var channel = window.plbx_html || window.super_html;
    if (window.super_html_channel && channel && channel.download) {
      channel.download();
    } else {
      window.open('https://play.google.com/store/apps/details?id=com.example.plain');
    }
  });
})();
