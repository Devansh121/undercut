import os from 'node:os';

// Interfaces a phone on the same Wi-Fi cannot reach: container bridges, VM host-only
// networks and overlay VPNs.
const OTHER_NAME =
  /^(docker|br-|veth|virbr|vboxnet|vmnet|vEthernet|podman|cni|flannel|cali|kube|lxc|lxd|tailscale|ts\d|tun|tap|utun|wg|zt|ham)/i;

function ipv4ToInt(address) {
  return address.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inCidr(address, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(base) & mask);
}

/**
 * Split non-internal IPv4 addresses into `lan` (likely the Wi-Fi or Ethernet a phone
 * can reach) and `other` (docker, VPN, link-local).
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} interfaces
 */
export function classifyInterfaces(interfaces = os.networkInterfaces()) {
  const lan = [];
  const other = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      const family = typeof info.family === 'number' ? `IPv${info.family}` : info.family;
      if (family !== 'IPv4' || info.internal) continue;
      const isOther =
        OTHER_NAME.test(name) ||
        inCidr(info.address, '100.64.0.0', 10) || // CGNAT range used by Tailscale
        inCidr(info.address, '169.254.0.0', 16); // link-local
      (isOther ? other : lan).push({ name, address: info.address });
    }
  }
  return { lan, other };
}
