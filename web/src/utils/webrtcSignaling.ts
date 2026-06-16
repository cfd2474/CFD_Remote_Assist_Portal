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

  const sdp = msg.sdp as RTCSessionDescriptionInit | string | undefined;
  if (typeof sdp === "object" && sdp?.type && sdp.sdp) {
    result.sdp = sdp;
  } else if (typeof sdp === "string") {
    const type =
      msg.type === "answer" || msg.signal === "answer"
        ? "answer"
        : msg.type === "offer" || msg.signal === "offer"
          ? "offer"
          : undefined;
    if (type) result.sdp = { type, sdp };
  }

  if (!result.sdp && msg.type === "answer" && typeof msg.sdp === "string") {
    result.sdp = { type: "answer", sdp: msg.sdp };
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

export function isOffer(sdp: RTCSessionDescriptionInit): boolean {
  return sdp.type === "offer";
}

/** Device-initiated mid-session offers include sendonly video; portal offers are recvonly. */
export function isDeviceRenegotiationOffer(sdp: RTCSessionDescriptionInit): boolean {
  const text = sdp.sdp ?? "";
  return sdp.type === "offer" && /a=sendonly/.test(text);
}
