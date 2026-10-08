/** Browser stand-in. The harness never encrypts a Sage password. */
function hash() {
  return {
    update() {
      return this;
    },
    digest() {
      return "";
    },
  };
}

export function createHash() {
  return hash();
}

export function createHmac() {
  return hash();
}

export function randomBytes(size: number) {
  return new Uint8Array(size);
}

export function createCipheriv() {
  return {
    update() {
      return "";
    },
    final() {
      return "";
    },
    getAuthTag() {
      return new Uint8Array(16);
    },
  };
}

export function createDecipheriv() {
  return {
    setAuthTag() {},
    update() {
      return "";
    },
    final() {
      return "";
    },
  };
}

export function timingSafeEqual() {
  return false;
}
