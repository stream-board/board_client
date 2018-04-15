let signalingSocket /* our socket.io connection to our webserver */
let localMediaStream /* our own microphone / webcam */
let peers /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
let peerMediaElements /* keep track of our <video>/<audio> tags, indexed by peer_id */
let roomMaster
let master
let channel
let speakers
let amISpeaker
export default {
  name: 'Streaming',
  mounted: function () {
    channel = this.$route.params.roomid
    this.$bus.on('activate-cam', this.toggleVideo)
    this.$bus.on('block-cam', this.toggleVideo)
    this.$bus.on('ask-for-mic', this.askForWord)
    this.$bus.on('mute-mic', this.muteAll)
    componentLoaded(this)
  },
  methods: {
    amIMaster () {
      // document.getElementById('demo').innerHTML = roomMaster;
    },
    askForWord () {
      signalingSocket.emit('relayAskForWord', {
        'channel': channel
      })
    },
    muteAll () {
      signalingSocket.emit('relayMuteAll', {
        'channel': channel
      })
    },
    toggleAudio () {
      if (localMediaStream.getAudioTracks()[0].enabled) {
        $('#local_video').css('border', '1px solid #f44336')
        signalingSocket.emit('relayMuteMyself', {'channel': channel})
      } else {
        $('#local_video').css('border', '')
        signalingSocket.emit('relayUnMuteMyself', {'channel': channel})
      }
      localMediaStream.getAudioTracks()[0].enabled =
        !(localMediaStream.getAudioTracks()[0].enabled)
    },
    toggleVideo () {
      console.log('Disabling myself video')
      localMediaStream.getVideoTracks()[0].enabled =
        !(localMediaStream.getVideoTracks()[0].enabled)
    },
    setSpeakers (speakers, master) {
      console.log('rendering speakers')
      if (!roomMaster) {
        $('video').css('border', '1px solid #f44336')
      } else {
        $('video').not('#local_video').css('border', '1px solid #f44336')
      }
      for (let speaker in speakers) {
        $('#' + speaker).css('border', '')
      }
      $('#' + master).css('border', '')
    }
  }
}
function componentLoaded (_this) {
  let $swal = _this.$swal
  /** CONFIG **/
  let SIGNALING_SERVER = 'ws://54.224.164.98:8444'
  // let SIGNALING_SERVER = 'ws://localhost:8444';
  // let SIGNALING_SERVER = 'ws://192.168.99.101:8444';
  let USE_AUDIO = true
  let USE_VIDEO = true
  let MUTE_AUDIO_BY_DEFAULT = true
  /** You should probably use a different stun server doing commercial stuff **/
  /** Also see: https://gist.github.com/zziuni/3741933 **/
  let ICE_SERVERS = [{
    url: 'stun:stun.l.google.com:19302'
  }]

  function initlets () {
    signalingSocket = null /* our socket.io connection to our webserver */
    localMediaStream = null /* our own microphone / webcam */
    peers = {} /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
    peerMediaElements = {} /* keep track of our <video>/<audio> tags, indexed by peer_id */
    roomMaster = false
    master = null
    speakers = {}
    amISpeaker = false
  }

  let attachMediaStream = function (element, stream) {
    element.srcObject = stream
  }

  console.log('Connecting to signaling server')
  initlets()
  // eslint-disable-next-line
  signalingSocket = io(SIGNALING_SERVER)
  signalingSocket.on('connect', function () {
    console.log('Connected to signaling server')
    console.log('Connected to room' + channel)
    signalingSocket.emit('relayRoomMaster', channel, function (config) {
      console.log('roomMaster: ', config)
      roomMaster = config.isRoomMaster
      master = config.roomMaster
    })
    setupLocalMedia(function () {
      /* once the user has given us access to their
       * microphone/camcorder, join the channel and start peering up */
      joinChatChannel(channel, {
        'whatever-you-want-here': 'stuff'
      })
    })
  })
  signalingSocket.on('disconnect', function () {
    console.log('Disconnected from signaling server')
    /* Tear down all of our peer connections and remove all the
     * media divs when we disconnect */
    for (let peerId in peerMediaElements) {
      peerMediaElements[peerId].remove()
    }
    for (let peerId in peers) {
      peers[peerId].close()
    }

    peers = {}
    peerMediaElements = {}
    initlets()
  })

  function joinChatChannel (channel, userdata) {
    signalingSocket.emit('join', {
      'channel': channel,
      'userdata': userdata
    })
  }

  /*
   * When we join a group, our signaling server will send out 'addPeer' events to each pair
   * of users in the group (creating a fully-connected graph of users, ie if there are 6 people
   * in the channel you will connect directly to the other 5, so there will be a total of 15
   * connections in the network).
   */
  signalingSocket.on('addPeer', function (config) {
    console.log('Signaling server said to add peer:', config)
    let peerId = config.peer_id
    console.log(config)
    speakers = config.speakers
    console.log(config.is_speaker)
    amISpeaker = config.is_speaker
    if (peerId in peers) {
      /* This could happen if the user joins multiple channels where the other peer is also in. */
      console.log('Already connected to peer ', peerId)
      return
    }
    let peerConnection = new RTCPeerConnection({
      'iceServers': ICE_SERVERS
    }, {
      'optional': [{
        'DtlsSrtpKeyAgreement': true
      }]
    }
      /* this will no longer be needed by chrome
       * eventually (supposedly), but is necessary
       * for now to get firefox to talk to chrome */
    )
    peers[peerId] = peerConnection

    peerConnection.onicecandidate = function (event) {
      if (event.candidate) {
        signalingSocket.emit('relayICECandidate', {
          'peer_id': peerId,
          'ice_candidate': {
            'sdpMLineIndex': event.candidate.sdpMLineIndex,
            'candidate': event.candidate.candidate
          }
        })
      }
    }
    peerConnection.onaddstream = function (event) {
      console.log('onAddStream', event)
      let remoteMedia = USE_VIDEO ? $('<video>') : $('<audio>')
      remoteMedia.attr('autoplay', 'autoplay')
      if (MUTE_AUDIO_BY_DEFAULT) {
        remoteMedia.attr('muted', 'true')
      }
      remoteMedia.attr('controls', '')
      remoteMedia.attr('id', peerId)
      peerMediaElements[peerId] = remoteMedia
      $('#client-videos').append(remoteMedia)
      $('#' + peerId).height('100%')
      $('#' + peerId).width('40%')
      attachMediaStream(remoteMedia[0], event.stream)
      console.log('speakers in css: ' + amISpeaker)
      console.log('master in css: ' + roomMaster)
      if (!(peerId in speakers) && peerId !== master) {
        $('#' + peerId).css('border', '1px solid #f44336')
        // remote_media.getAudioTracks()[0].enabled = false;
      }
      if (!roomMaster) {
        $('#local_video').css('border', '1px solid #f44336')
      }
    }

    /* Add our local stream */
    peerConnection.addStream(localMediaStream)

    /* Only one side of the peer connection should create the
     * offer, the signaling server picks one to be the offerer.
     * The other user will get a 'sessionDescription' event and will
     * create an offer, then send back an answer 'sessionDescription' to us
     */
    if (config.should_create_offer) {
      console.log('Creating RTC offer to ', peerId)
      peerConnection.createOffer(
        function (localDescription) {
          console.log('Local offer description is: ', localDescription)
          peerConnection.setLocalDescription(localDescription,
            function () {
              signalingSocket.emit('relaySessionDescription', {
                'peer_id': peerId,
                'session_description': localDescription
              })
              console.log('Offer setLocalDescription succeeded')
            },
            function () {
              alert('Offer setLocalDescription failed!')
            }
          )
        },
        function (error) {
          console.log('Error sending offer: ', error)
        })
    }
  })

  /**
   * Peers exchange session descriptions which contains information
   * about their audio / video settings and that sort of stuff. First
   * the 'offerer' sends a description to the 'answerer' (with type
   * 'offer'), then the answerer sends one back (with type 'answer').
   */
  signalingSocket.on('sessionDescription', function (config) {
    console.log('Remote description received: ', config)
    let peerId = config.peer_id
    let peer = peers[peerId]
    let remoteDescription = config.session_description
    console.log(config.session_description)

    let desc = new RTCSessionDescription(remoteDescription)
    peer.setRemoteDescription(desc,
      function () {
        console.log('setRemoteDescription succeeded')
        if (remoteDescription.type === 'offer') {
          console.log('Creating answer')
          peer.createAnswer(
            function (localDescription) {
              console.log('Answer description is: ', localDescription)
              peer.setLocalDescription(localDescription,
                function () {
                  signalingSocket.emit('relaySessionDescription', {
                    'peer_id': peerId,
                    'session_description': localDescription
                  })
                  console.log('Answer setLocalDescription succeeded')
                },
                function () {
                  alert('Answer setLocalDescription failed!')
                }
              )
            },
            function (error) {
              console.log('Error creating answer: ', error)
              console.log(peer)
            })
        }
      },
      function (error) {
        console.log('setRemoteDescription error: ', error)
      }
    )
    console.log('Description Object: ', desc)
  })

  /**
   * The offerer will send a number of ICE Candidate blobs to the answerer so they
   * can begin trying to find the best path to one another on the net.
   */
  signalingSocket.on('iceCandidate', function (config) {
    let peer = peers[config.peer_id]
    let iceCandidate = config.ice_candidate
    peer.addIceCandidate(new RTCIceCandidate(iceCandidate))
  })

  /**
   * When a user leaves a channel (or is disconnected from the
   * signaling server) everyone will recieve a 'removePeer' message
   * telling them to trash the media channels they have open for those
   * that peer. If it was this client that left a channel, they'll also
   * receive the removePeers. If this client was disconnected, they
   * wont receive removePeers, but rather the
   * signaling_socket.on('disconnect') code will kick in and tear down
   * all the peer sessions.
   */
  signalingSocket.on('removePeer', function (config) {
    console.log('Signaling server said to remove peer:', config)
    let peerId = config.peer_id
    if (peerId in peerMediaElements) {
      peerMediaElements[peerId].remove()
    }
    if (peerId in peers) {
      peers[peerId].close()
    }

    delete peers[peerId]
    delete peerMediaElements[config.peer_id]
  })

  signalingSocket.on('roomMaster', function (config) {
    console.log('roomMaster: ', config)
    roomMaster = config.isRoomMaster
    master = config.roomMaster
  })

  signalingSocket.on('askForWord', function (data) {
    console.log('someone asking word')
    $swal({
      title: 'Talk petition',
      text: `User ${data.asker} wants to use the board`,
      type: 'question',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, approve',
      cancelButtonText: 'No, disapprove'
    }).then((result) => {
      if (result.value) {
        $swal(
          'Approved',
          'User has the permission',
          'success'
        )
        signalingSocket.emit('relayGiveWord', {
          'channel': channel,
          'asker': data.asker
        })
      } else {
        $swal(
          'Disapproved',
          'You disapproved the user',
          'error'
        )
        // socket.emit('answerForBoard', {answer: false, socketId: data.socketId})
      }
    })
  })

  signalingSocket.on('muteAll', function (config) {
    let masterId = config.master
    speakers = {}
    setSpeakers(speakers, masterId, roomMaster)
    if (!roomMaster) {
      console.log('Muting localstream audio')
      localMediaStream.getAudioTracks()[0].enabled = false
      // document.getElementById('muted').innerHTML = 'Muted: True';
    }
  })

  signalingSocket.on('giveWord', function (config) {
    amISpeaker = config.amISpeaker
    speakers = config.speakers

    for (let speaker in speakers) {
      $('#' + speaker).css('border', '')
    }

    if (amISpeaker) {
      localMediaStream.getAudioTracks()[0].enabled = true
      $('#local_video').css('border', '')
      // document.getElementById('muted').innerHTML = 'Muted: False';
    }
  })

  signalingSocket.on('roomDestroyed', function (config) {
    document.body.innerHTML = ''
    let info = document.createTextNode('Tu sala ha cerrado')
    $('#all-videos').append(info)
    initlets()
  })

  signalingSocket.on('mute', function (config) {
    let toMute = config.peer_id
    console.log('unmuting' + toMute)
    $('#' + toMute).css('border', '1px solid #f44336')
  })
  signalingSocket.on('unMute', function (config) {
    let toUnMute = config.peerId
    console.log('unmuting' + toUnMute)
    $('#' + toUnMute).css('border', '')
  })
  /***********************/
  /** Local media stuff **/
  /***********************/
  function setupLocalMedia (callback, errorback) {
    if (localMediaStream != null) { /* ie, if we've already been initialized */
      if (callback) callback()
      return
    }
    /* Ask user for permission to use the computers microphone and/or camera,
     * attach it to an <audio> or <video> tag if they give us access. */
    console.log('Requesting access to local audio / video inputs')

    navigator.getUserMedia = (navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia)

    navigator.getUserMedia({
      'audio': USE_AUDIO,
      'video': USE_VIDEO
    },
    function (stream) { /* user accepted access to a/v */
      console.log('Access granted to audio/video')
      localMediaStream = stream
      let localMedia = USE_VIDEO ? $('<video>') : $('<audio>')
      localMedia.attr('autoplay', 'autoplay')
      localMedia.attr('muted', 'true') /* always mute ourselves by default */
      localMedia.attr('controls', '')
      localMedia.attr('id', 'local_video')
      // console.log( $('#all-videos').innerHTML );
      $('#master-videos').append(localMedia)
      $('#local_video').height('40%')
      $('#local_video').width('100%')
      attachMediaStream(localMedia[0], stream)
      // document.getElementById('muted').innerHTML = 'Muted: False';
      console.log('am_i_speaker: ' + amISpeaker)
      console.log('am_i_master: ' + roomMaster)
      if (!amISpeaker && !roomMaster) {
        localMediaStream.getAudioTracks()[0].enabled = false
        // document.getElementById('muted').innerHTML = 'Muted: True';
      }
      if (callback) callback()
    },
    function () { /* user denied access to a/v */
      console.log('Access denied for audio/video')
      alert('You chose not to provide access to the camera/microphone, demo will not work.')
      if (errorback) errorback()
    })
  }

  function setSpeakers (speakers, master) {
    console.log('rendering speakers')
    if (!roomMaster) {
      $('video').css('border', '1px solid #f44336')
    } else {
      $('video').not('#local_video').css('border', '1px solid #f44336')
    }
    for (let speaker in speakers) {
      $('#' + speaker).css('border', '')
    }
    $('#' + master).css('border', '')
  }
}
