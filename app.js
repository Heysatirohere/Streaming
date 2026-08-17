// CastP2P - Pure P2P Screen Sharing Application

// State Variables
let peer = null;
let myPeerId = null;
let currentCall = null;
let pendingCall = null;
let localStream = null;
let remoteStream = null;

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const myPeerIdInput = document.getElementById('my-peer-id');
const btnCopyId = document.getElementById('btn-copy-id');
const remotePeerIdInput = document.getElementById('remote-peer-id');
const btnConnectPeer = document.getElementById('btn-connect-peer');
const btnStartShare = document.getElementById('btn-start-share');
const btnStopShare = document.getElementById('btn-stop-share');

const videoContainer = document.getElementById('video-container');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const placeholderOverlay = document.getElementById('placeholder-overlay');
const videoControlsOverlay = document.getElementById('video-controls-overlay');
const selfPreviewBox = document.getElementById('self-preview-box');
const btnClosePreview = document.getElementById('btn-close-preview');

const btnPip = document.getElementById('btn-pip');
const btnFullscreen = document.getElementById('btn-fullscreen');

const privacyModal = document.getElementById('privacy-modal');
const callerPeerIdText = document.getElementById('caller-peer-id-text');
const btnAcceptCall = document.getElementById('btn-accept-call');
const btnDeclineCall = document.getElementById('btn-decline-call');
const toastContainer = document.getElementById('toast-container');

// --- 1. Initialize PeerJS with Public STUN Servers ---
function initPeer() {
  updateStatus('connecting', 'Connecting to Peer Server...');

  // Configuration with Google Public STUN servers for robust NAT traversal
  peer = new Peer({
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  // Event: Open (Peer ID generated)
  peer.on('open', (id) => {
    myPeerId = id;
    myPeerIdInput.value = id;
    btnStartShare.disabled = false;
    updateStatus('ready', 'Ready to Stream');
    showToast('Peer connection established! Your ID is ready.', 'success');
  });

  // Event: Incoming Call (Privacy Confirmation Flow)
  peer.on('call', (incomingCall) => {
    pendingCall = incomingCall;
    callerPeerIdText.textContent = incomingCall.peer;
    privacyModal.classList.remove('hidden');
    showToast(`Incoming screen share request from ${incomingCall.peer.substring(0, 8)}...`, 'info');
  });

  // Event: Error handling
  peer.on('error', (err) => {
    console.error('PeerJS Error:', err);
    let errMsg = 'PeerJS error occurred.';
    if (err.type === 'peer-unavailable') {
      errMsg = 'Peer ID not found. Verify your friend\'s ID.';
    } else if (err.type === 'network') {
      errMsg = 'Network error. Please check your internet connection.';
    } else if (err.type === 'browser-incompatible') {
      errMsg = 'WebRTC is not supported on this browser.';
    }
    showToast(errMsg, 'error');
    updateStatus('ready', 'Ready');
  });

  // Event: Disconnected
  peer.on('disconnected', () => {
    updateStatus('offline', 'Disconnected');
    showToast('Disconnected from signaling server. Attempting reconnect...', 'error');
    peer.reconnect();
  });
}

// --- 2. Privacy Modal Accept / Decline Handlers ---
btnAcceptCall.addEventListener('click', () => {
  if (!pendingCall) return;

  privacyModal.classList.add('hidden');
  currentCall = pendingCall;
  pendingCall = null;

  // Answer call without sending a local stream (receiver view mode)
  currentCall.answer(null);

  // Handle incoming remote media stream
  currentCall.on('stream', (stream) => {
    handleRemoteStream(stream);
  });

  currentCall.on('close', () => {
    resetRemoteStream();
    showToast('Stream closed by remote peer.', 'info');
  });

  currentCall.on('error', (err) => {
    console.error('Call Error:', err);
    showToast('Stream connection error.', 'error');
    resetRemoteStream();
  });
});

btnDeclineCall.addEventListener('click', () => {
  if (pendingCall) {
    pendingCall.close();
    pendingCall = null;
  }
  privacyModal.classList.add('hidden');
  showToast('Screen share call declined.', 'info');
});

// --- 3. Start Screen Sharing (getDisplayMedia with Constraints) ---
async function startScreenShare() {
  if (!myPeerId) {
    showToast('Peer network not initialized yet.', 'error');
    return;
  }

  // Check if getDisplayMedia is supported
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast('Screen sharing is not supported in this browser.', 'error');
    return;
  }

  try {
    // Media constraints for fluid 1080p stream at 30-60fps
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        width: { max: 1920 },
        height: { max: 1080 }
      },
      audio: false
    });

    // Display local self-preview
    localVideo.srcObject = localStream;
    selfPreviewBox.classList.remove('hidden');

    // UI state update
    btnStartShare.classList.add('hidden');
    btnStopShare.classList.remove('hidden');
    updateStatus('live', 'Sharing Your Screen');

    // Listen to native browser "Stop sharing" event
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        showToast('Screen share stopped.', 'info');
        stopScreenShare();
      };
    }

    // Call connected remote peer if target ID is provided
    const targetPeerId = remotePeerIdInput.value.trim();
    if (targetPeerId) {
      callRemotePeer(targetPeerId);
    } else {
      showToast('Sharing screen locally. Enter friend\'s ID & click Connect to stream to them.', 'info');
    }

  } catch (err) {
    console.error('getDisplayMedia Error:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Screen sharing permission was denied.', 'error');
    } else {
      showToast(`Could not start screen share: ${err.message}`, 'error');
    }
    stopScreenShare();
  }
}

// --- 4. Call Remote Peer with Local Stream ---
function callRemotePeer(targetId) {
  if (!localStream) {
    showToast('Please start screen sharing first before connecting.', 'info');
    return;
  }

  if (targetId === myPeerId) {
    showToast('You cannot call your own Peer ID!', 'error');
    return;
  }

  showToast(`Calling peer ${targetId.substring(0, 8)}...`, 'info');
  updateStatus('connecting', 'Connecting to Friend...');

  currentCall = peer.call(targetId, localStream);

  currentCall.on('stream', (stream) => {
    handleRemoteStream(stream);
  });

  currentCall.on('close', () => {
    showToast('Call ended by remote peer.', 'info');
    resetRemoteStream();
  });

  currentCall.on('error', (err) => {
    console.error('Call Error:', err);
    showToast('Failed to establish stream with remote peer.', 'error');
  });
}

// --- 5. Stop Screen Share & Reset UI ---
function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }

  localVideo.srcObject = null;
  selfPreviewBox.classList.add('hidden');

  btnStartShare.classList.remove('hidden');
  btnStopShare.classList.add('hidden');

  if (!remoteStream) {
    updateStatus('ready', 'Ready');
  }
}

// Handle Incoming Remote Video Stream
function handleRemoteStream(stream) {
  remoteStream = stream;
  remoteVideo.srcObject = stream;
  remoteVideo.classList.remove('hidden');
  placeholderOverlay.classList.add('hidden');
  videoControlsOverlay.classList.remove('hidden');
  updateStatus('live', 'Live P2P Stream Active');
  showToast('Receiving live video stream!', 'success');
}

// Reset Remote Video Stream
function resetRemoteStream() {
  remoteStream = null;
  remoteVideo.srcObject = null;
  remoteVideo.classList.add('hidden');
  placeholderOverlay.classList.remove('hidden');
  videoControlsOverlay.classList.add('hidden');
  if (!localStream) {
    updateStatus('ready', 'Ready');
  }
}

// --- 6. Helper Functions & Event Listeners ---

// Update UI Status Badge
function updateStatus(state, text) {
  statusBadge.className = `status-badge status-${state}`;
  statusText.textContent = text;
}

// Copy Peer ID to Clipboard
btnCopyId.addEventListener('click', () => {
  if (!myPeerId) return;
  navigator.clipboard.writeText(myPeerId).then(() => {
    showToast('Peer ID copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy ID.', 'error');
  });
});

// Connect Button Click
btnConnectPeer.addEventListener('click', () => {
  const targetId = remotePeerIdInput.value.trim();
  if (!targetId) {
    showToast('Please enter a friend\'s Peer ID first.', 'error');
    return;
  }
  if (localStream) {
    callRemotePeer(targetId);
  } else {
    showToast('Waiting for incoming stream, or start your screen share.', 'info');
  }
});

// Start & Stop Share Buttons
btnStartShare.addEventListener('click', startScreenShare);
btnStopShare.addEventListener('click', stopScreenShare);

// Close Self Preview
btnClosePreview.addEventListener('click', () => {
  selfPreviewBox.classList.add('hidden');
});

// Fullscreen Toggle
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => {
      showToast(`Fullscreen error: ${err.message}`, 'error');
    });
  } else {
    document.exitFullscreen();
  }
});

// Picture-in-Picture Toggle
btnPip.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (remoteVideo.readyState >= 2) {
      await remoteVideo.requestPictureInPicture();
    } else {
      showToast('No active video stream to enter PiP.', 'info');
    }
  } catch (err) {
    showToast(`PiP error: ${err.message}`, 'error');
  }
});

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '⚠️';

  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Launch Peer Initialization on Load
window.addEventListener('DOMContentLoaded', initPeer);
