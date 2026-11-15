/* Keeps a Fire TV from going to sleep while the tap list is on screen.
   Fire OS treats a page that is playing video as "someone is watching" and does not sleep or start the
   screen saver. So we play a tiny, silent, black, looping video in a corner of the page.
   As a second layer, we also ask the browser for a screen wake lock where it is supported.
   Only outdoor.html loads this. index.html (the Brewhouse TV and website) does not.
   Plain old JavaScript, like the rest of the TV page. */
(function () {
  var video = null, lock = null;

  function play() {
    if (!video) return;
    try {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* blocked for now; check() tries again */ });
    } catch (e) {}
  }

  function startVideo() {
    video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('tabindex', '-1');
    // Must stay "visible" to the browser (not display:none), so keep it tiny and nearly transparent.
    video.style.cssText = 'position:fixed;right:0;bottom:0;width:4px;height:4px;opacity:0.02;pointer-events:none;z-index:2';
    video.innerHTML = '<source src="keepawake.mp4" type="video/mp4"><source src="keepawake.webm" type="video/webm">';
    document.body.appendChild(video);
    play();
  }

  function requestLock() {
    try {
      if (!navigator.wakeLock || (lock && !lock.released)) return;
      navigator.wakeLock.request('screen').then(function (l) { lock = l; }, function () { lock = null; });
    } catch (e) {}
  }

  function check() {
    if (video && (video.paused || video.ended)) play();
    requestLock();
  }

  function init() {
    startVideo();
    requestLock();
    setInterval(check, 20 * 1000);
    document.addEventListener('visibilitychange', check);
    // If the browser blocks autoplay, any remote button press starts the video.
    document.addEventListener('keydown', play);
    document.addEventListener('click', play);
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
