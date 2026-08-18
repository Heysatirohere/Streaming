// CastP2P - Pure P2P Screen Sharing Application

// State Variables
let peer = null;
let myPeerId = null;
let activeCalls = {}; // Multi-viewer active connections dictionary
let pendingCall = null;
let localStream = null;
let micStreamTrack = null;
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
const viewersBadge = document.getElementById('viewers-badge');
const selfPreviewBox = document.getElementById('self-preview-box');
const btnClosePreview = document.getElementById('btn-close-preview');

const audioStatusBadge = document.getElementById('audio-status-badge');
const audioStatusText = document.getElementById('audio-status-text');
const btnVolumeToggle = document.getElementById('btn-volume-toggle');
const iconVolumeOn = document.getElementById('icon-volume-on');
const iconVolumeOff = document.getElementById('icon-volume-off');
const volumeSlider = document.getElementById('volume-slider');
const unmuteBanner = document.getElementById('unmute-banner');
const btnUnmuteOverlay = document.getElementById('btn-unmute-overlay');

const chkSystemAudio = document.getElementById('chk-system-audio');
const chkMicAudio = document.getElementById('chk-mic-audio');

const btnPip = document.getElementById('btn-pip');
const btnFullscreen = document.getElementById('btn-fullscreen');

const privacyModal = document.getElementById('privacy-modal');
const callerPeerIdText = document.getElementById('caller-peer-id-text');
const btnAcceptCall = document.getElementById('btn-accept-call');
const btnDeclineCall = document.getElementById('btn-decline-call');
const toastContainer = document.getElementById('toast-container');

// --- Helper: Mix System Audio + Microphone into a single MediaStreamTrack ---
function createMixedAudioTrack(displayStream, micStream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();

    if (displayStream && displayStream.getAudioTracks().length > 0) {
      const displaySource = audioCtx.createMediaStreamSource(displayStream);
      displaySource.connect(dest);
    }

    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(dest);
    }

    const mixedTracks = dest.stream.getAudioTracks();
    if (mixedTracks.length > 0) {
      return mixedTracks[0];
    }
  } catch (e) {
    console.warn('AudioContext mixing error, falling back to direct track:', e);
  }
  return (displayStream && displayStream.getAudioTracks()[0]) || (micStream && micStream.getAudioTracks()[0]);
}

// --- 1. Bitrate Booster Optimization (Force 5 Mbps & High Network Priority) ---
function applyHighBitrate(call) {
  const apply = () => {
    try {
      const pc = call.peerConnection;
      if (!pc) return;
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && videoSender.getParameters) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings || parameters.encodings.length === 0) {
          parameters.encodings = [{}];
        }
        parameters.encodings[0].maxBitrate = 5000000; // 5 Mbps (5,000,000 bits/sec)
        parameters.encodings[0].networkPriority = 'high';
        parameters.encodings[0].priority = 'high';
        videoSender.setParameters(parameters).then(() => {
          console.log(`[Bitrate Booster] 5 Mbps & High Priority applied for peer: ${call.peer}`);
        }).catch(err => console.warn('Could not set maxBitrate:', err));
      }
    } catch (e) {
      console.warn('Error applying high bitrate:', e);
    }
  };

  if (call.peerConnection) {
    const iceState = call.peerConnection.iceConnectionState;
    if (iceState === 'connected' || iceState === 'completed') {
      apply();
    } else {
      call.peerConnection.addEventListener('iceconnectionstatechange', () => {
        const newState = call.peerConnection.iceConnectionState;
        if (newState === 'connected' || newState === 'completed') {
          apply();
        }
      });
    }
  }
}

// --- 2. Active Calls Registration & Viewers Badge Counter ---
function updateViewersBadge() {
  const count = Object.keys(activeCalls).length;
  if (viewersBadge) {
    if (count > 0 && localStream) {
      viewersBadge.textContent = `👥 ${count} Espectador${count > 1 ? 'es' : ''}`;
      viewersBadge.classList.remove('hidden');
    } else {
      viewersBadge.classList.add('hidden');
    }
  }
}

function registerCall(call) {
  activeCalls[call.peer] = call;
  updateViewersBadge();
  applyHighBitrate(call);

  call.on('stream', (stream) => {
    handleRemoteStream(stream);
  });

  call.on('close', () => {
    delete activeCalls[call.peer];
    updateViewersBadge();
    if (Object.keys(activeCalls).length === 0 && !localStream) {
      resetRemoteStream();
    }
    showToast(`Conexão com ${call.peer.substring(0, 6)}... encerrada.`, 'info');
  });

  call.on('error', (err) => {
    console.error('Call Error:', err);
    delete activeCalls[call.peer];
    updateViewersBadge();
  });
}

// Update UI Status Badge
function updateStatus(state, text) {
  if (statusBadge && statusText) {
    statusBadge.className = `status-badge status-${state}`;
    statusText.textContent = text;
  }
}

// --- 3. Initialize PeerJS with Public STUN Servers ---
function initPeer() {
  updateStatus('connecting', 'Conectando ao Servidor Peer...');

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
    updateStatus('ready', 'Pronto para Transmitir');
    showToast('Conexão P2P estabelecida! ID gerado.', 'success');

    // Auto-Connect via URL query parameter: ?watch=HOST_PEER_ID
    const urlParams = new URLSearchParams(window.location.search);
    const watchHostId = urlParams.get('watch');
    if (watchHostId && watchHostId !== id) {
      remotePeerIdInput.value = watchHostId;
      showToast(`Link de convite detectado! Conectando ao host ${watchHostId.substring(0, 8)}...`, 'info');
      connectToHost(watchHostId);
    }
  });

  // Event: Incoming Call (Multi-Viewer & Consent Flow)
  peer.on('call', (incomingCall) => {
    if (localStream) {
      // Host mode: Automatically answer with local screen stream
      incomingCall.answer(localStream);
      registerCall(incomingCall);
      showToast(`Novo espectador conectado: ${incomingCall.peer.substring(0, 6)}... 👥`, 'success');
    } else {
      // Viewer mode: Prompt user to confirm incoming screen stream
      pendingCall = incomingCall;
      callerPeerIdText.textContent = incomingCall.peer;
      privacyModal.classList.remove('hidden');
      showToast(`Solicitação de transmissão de ${incomingCall.peer.substring(0, 8)}...`, 'info');
    }
  });

  // Event: Error handling
  peer.on('error', (err) => {
    console.error('PeerJS Error:', err);
    let errMsg = 'Ocorreu um erro no PeerJS.';
    if (err.type === 'peer-unavailable') {
      errMsg = 'ID do Peer não encontrado. Verifique o ID do host.';
    } else if (err.type === 'network') {
      errMsg = 'Erro de rede. Verifique sua conexão com a internet.';
    } else if (err.type === 'browser-incompatible') {
      errMsg = 'Seu navegador não suporta WebRTC.';
    }
    showToast(errMsg, 'error');
    updateStatus('ready', 'Pronto');
  });

  // Event: Disconnected
  peer.on('disconnected', () => {
    updateStatus('offline', 'Desconectado');
    showToast('Desconectado do servidor de sinalização. Reconectando...', 'error');
    peer.reconnect();
  });
}

// --- 4. Privacy Modal Accept / Decline Handlers ---
btnAcceptCall.addEventListener('click', () => {
  if (!pendingCall) return;

  privacyModal.classList.add('hidden');
  const call = pendingCall;
  pendingCall = null;

  // Answer call as viewer receiving stream
  call.answer(null);
  registerCall(call);
});

btnDeclineCall.addEventListener('click', () => {
  if (pendingCall) {
    pendingCall.close();
    pendingCall = null;
  }
  privacyModal.classList.add('hidden');
  showToast('Chamada recusada.', 'info');
});

// --- 5. Start Screen Sharing (getDisplayMedia with Audio Fixes) ---
async function startScreenShare() {
  if (!myPeerId) {
    showToast('Rede P2P ainda não inicializada.', 'error');
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast('Compartilhamento de tela não é suportado neste navegador.', 'error');
    return;
  }

  try {
    let displayAudioConstraint = false;
    if (chkSystemAudio && chkSystemAudio.checked) {
      // FIX CRÍTICO: echoCancellation e noiseSuppression desativados para áudio do sistema!
      // Se ativados, o WebRTC interpreta música/sons do sistema como ruído de fundo e mudo o som!
      displayAudioConstraint = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false
      };
    }

    // Capturar compartilhamento de tela com constraints otimizadas
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        width: { max: 1920 },
        height: { max: 1080 }
      },
      audio: displayAudioConstraint,
      systemAudio: 'include'
    });

    // Captura opcional de Microfone se o usuário marcou a opção
    let micStream = null;
    if (chkMicAudio && chkMicAudio.checked) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (micErr) {
        console.warn('Falha ao acessar microfone:', micErr);
        showToast('Aviso: Não foi possível acessar o microfone.', 'info');
      }
    }

    const displayAudioTracks = localStream.getAudioTracks();
    const hasMicAudio = micStream && micStream.getAudioTracks().length > 0;

    if (displayAudioTracks.length > 0 && hasMicAudio) {
      const mixedTrack = createMixedAudioTrack(localStream, micStream);
      if (mixedTrack) {
        displayAudioTracks.forEach(t => localStream.removeTrack(t));
        localStream.addTrack(mixedTrack);
        showToast('Áudio do Sistema + Microfone capturados com sucesso! 🔊🎤', 'success');
      }
    } else if (hasMicAudio && displayAudioTracks.length === 0) {
      micStreamTrack = micStream.getAudioTracks()[0];
      localStream.addTrack(micStreamTrack);
      showToast('Áudio do Microfone incluído na transmissão! 🎤', 'success');
    } else if (displayAudioTracks.length > 0) {
      showToast('Áudio do sistema capturado com sucesso! 🔊', 'success');
    } else {
      showToast('Aviso: Nenhum áudio selecionado. Marque "Compartilhar áudio" no popup do navegador.', 'info');
    }

    // Display local self-preview
    localVideo.srcObject = localStream;
    selfPreviewBox.classList.remove('hidden');

    // UI state update
    btnStartShare.classList.add('hidden');
    btnStopShare.classList.remove('hidden');
    updateStatus('live', 'Transmitindo sua Tela');

    // Listen to native browser "Stop sharing" event
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        showToast('Transmissão encerrada.', 'info');
        stopScreenShare();
      };
    }

    // If target Peer ID is in input box, call them
    const targetPeerId = remotePeerIdInput.value.trim();
    if (targetPeerId) {
      connectToHost(targetPeerId);
    } else {
      showToast('Transmitindo tela! Copie seu link de convite e envie aos seus amigos.', 'info');
    }

  } catch (err) {
    console.error('getDisplayMedia Error:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Permissão de compartilhamento negada.', 'error');
    } else {
      showToast(`Erro ao iniciar compartilhamento: ${err.message}`, 'error');
    }
    stopScreenShare();
  }
}

// --- 6. Connect to Host / Remote Peer ---
function connectToHost(targetId) {
  if (targetId === myPeerId) {
    showToast('Você não pode conectar ao seu próprio ID!', 'error');
    return;
  }

  showToast(`Conectando a ${targetId.substring(0, 8)}...`, 'info');
  updateStatus('connecting', 'Conectando ao Host...');

  const call = peer.call(targetId, localStream || null);
  registerCall(call);
}

// --- 7. Stop Screen Share & Reset UI ---
function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (micStreamTrack) {
    micStreamTrack.stop();
    micStreamTrack = null;
  }

  // Close active viewer calls
  Object.keys(activeCalls).forEach(peerId => {
    if (activeCalls[peerId]) {
      activeCalls[peerId].close();
    }
  });
  activeCalls = {};

  localVideo.srcObject = null;
  selfPreviewBox.classList.add('hidden');

  btnStartShare.classList.remove('hidden');
  btnStopShare.classList.add('hidden');
  updateViewersBadge();

  if (!remoteStream) {
    updateStatus('ready', 'Pronto');
  }
}

// Handle Incoming Remote Video Stream
function handleRemoteStream(stream) {
  remoteStream = stream;
  remoteVideo.srcObject = stream;
  remoteVideo.classList.remove('hidden');
  placeholderOverlay.classList.add('hidden');
  videoControlsOverlay.classList.remove('hidden');
  updateStatus('live', 'Transmissão P2P Ao Vivo');

  const audioTracks = stream.getAudioTracks();
  const hasAudio = audioTracks.length > 0;

  if (audioStatusBadge && audioStatusText) {
    if (hasAudio) {
      audioStatusBadge.classList.remove('audio-disabled');
      audioStatusText.textContent = 'Áudio Ativo';
    } else {
      audioStatusBadge.classList.add('audio-disabled');
      audioStatusText.textContent = 'Sem Áudio';
    }
  }

  if (hasAudio) {
    showToast('Recebendo vídeo e áudio ao vivo! 🔊', 'success');
  } else {
    showToast('Recebendo vídeo ao vivo (sem canal de áudio)', 'info');
  }

  // Configuração inicial de volume e unmuted
  const targetVolume = parseFloat(volumeSlider.value) || 1.0;
  remoteVideo.volume = targetVolume;
  remoteVideo.muted = false;

  // Tentativa de reprodução com som desmutado (Respeitando Autoplay Policy)
  const playPromise = remoteVideo.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      unmuteBanner.classList.add('hidden');
      updateVolumeIcon(false);
    }).catch(err => {
      console.warn('Autoplay com áudio bloqueado pelo navegador. Mutando para permitir vídeo:', err);
      remoteVideo.muted = true;
      remoteVideo.play().catch(e => console.error('Erro no play com mudo:', e));
      unmuteBanner.classList.remove('hidden');
      updateVolumeIcon(true);
    });
  }
}

// Reset Remote Video Stream
function resetRemoteStream() {
  remoteStream = null;
  remoteVideo.srcObject = null;
  remoteVideo.classList.add('hidden');
  placeholderOverlay.classList.remove('hidden');
  videoControlsOverlay.classList.add('hidden');
  unmuteBanner.classList.add('hidden');
  if (!localStream) {
    updateStatus('ready', 'Pronto');
  }
}

// --- 8. Audio Controls & Event Listeners ---

function forceUnmuteAudio() {
  if (remoteVideo) {
    remoteVideo.muted = false;
    remoteVideo.volume = parseFloat(volumeSlider.value) || 1.0;
    remoteVideo.play().then(() => {
      unmuteBanner.classList.add('hidden');
      updateVolumeIcon(false);
      showToast('Som ativado com sucesso! 🔊', 'success');
    }).catch(err => {
      console.error('Erro ao desmutar:', err);
    });
  }
}

function updateVolumeIcon(isMuted) {
  if (!iconVolumeOn || !iconVolumeOff) return;
  if (isMuted || (remoteVideo && remoteVideo.volume === 0)) {
    iconVolumeOn.classList.add('hidden');
    iconVolumeOff.classList.remove('hidden');
  } else {
    iconVolumeOn.classList.remove('hidden');
    iconVolumeOff.classList.add('hidden');
  }
}

if (btnUnmuteOverlay) {
  btnUnmuteOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    forceUnmuteAudio();
  });
}

if (videoContainer) {
  videoContainer.addEventListener('click', () => {
    if (unmuteBanner && !unmuteBanner.classList.contains('hidden')) {
      forceUnmuteAudio();
    }
  });
}

if (btnVolumeToggle) {
  btnVolumeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!remoteVideo) return;
    remoteVideo.muted = !remoteVideo.muted;
    if (!remoteVideo.muted && remoteVideo.volume === 0) {
      remoteVideo.volume = 1.0;
      volumeSlider.value = 1.0;
    }
    updateVolumeIcon(remoteVideo.muted);
    if (!remoteVideo.muted) {
      unmuteBanner.classList.add('hidden');
    }
  });
}

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (remoteVideo) {
      remoteVideo.volume = val;
      if (val > 0 && remoteVideo.muted) {
        remoteVideo.muted = false;
        unmuteBanner.classList.add('hidden');
      }
      updateVolumeIcon(remoteVideo.muted || val === 0);
    }
  });
}

// Copy Invite Link to Clipboard
btnCopyId.addEventListener('click', () => {
  if (!myPeerId) return;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?watch=${myPeerId}`;

  navigator.clipboard.writeText(inviteUrl).then(() => {
    showToast('Link de convite copiado!', 'success');
  }).catch(() => {
    navigator.clipboard.writeText(myPeerId);
    showToast('ID copiado!', 'success');
  });
});

// Connect Button Click
btnConnectPeer.addEventListener('click', () => {
  const targetId = remotePeerIdInput.value.trim();
  if (!targetId) {
    showToast('Insira o ID do amigo ou use o link de convite.', 'error');
    return;
  }
  connectToHost(targetId);
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
      showToast(`Erro ao entrar em tela cheia: ${err.message}`, 'error');
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
      showToast('Nenhum vídeo ativo para modo PiP.', 'info');
    }
  } catch (err) {
    showToast(`Erro no PiP: ${err.message}`, 'error');
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
