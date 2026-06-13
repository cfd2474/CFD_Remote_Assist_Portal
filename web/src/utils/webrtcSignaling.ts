/** Normalize WebRTC signaling between portal and Android client formats. */

export type WebRtcOutbound =
  | { sdp: RTCSessionDescriptionInit }
  | { ice: RTCIceCandidateInit };

export function outboundOffer(sdp: RTCSessionDescriptionInit): WebRtcOutbound {
  return { sdp };
}

export function outboundIce(candidate: RTCIceCandidateInit): WebRtcOutbound {
  return { ice: candidate };
}

export function parseInboundSignaling(msg: Record<string, unknown>): {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
} {
  const result: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } = {};

  const sdp = msg.sdp as RTCSessionDescriptionInit | undefined;
  if (sdp?.type && sdp.sdp) {
    result.sdp = sdp;
  }

  const ice =
    (msg.ice as RTCIceCandidateInit | undefined) ??
    (msg.candidate as RTCIceCandidateInit | undefined);
  if (ice?.candidate) {
    result.ice = ice;
  }

  // Legacy portal format: signal + sdp/candidate
  const signal = msg.signal as string | undefined;
  if (!result.sdp && signal === "answer" && msg.sdp) {
    result.sdp = msg.sdp as RTCSessionDescriptionInit;
  }
  if (!result.ice && signal === "ice" && msg.candidate) {
    result.ice = msg.candidate as RTCIceCandidateInit;
  }

  return result;
}

export function isAnswer(sdp: RTCSessionDescriptionInit): boolean {
  return sdp.type === "answer";
}
