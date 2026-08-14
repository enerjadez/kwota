/** JDE finishing tag — always themed to the host site. Links to Performante. */
export const JDE_URL = "https://enerjadez.github.io/JdePerformante/";

export function jdeTagHtml(place = "dock") {
  const label =
    place === "pay"
      ? "cleared · JDE"
      : place === "sign"
        ? "forged by JDE"
        : "JDE";
  return `
    <a class="jde-chip jde-kwota jde-${place}" href="${JDE_URL}" target="_blank" rel="noopener noreferrer" aria-label="JDE Performante">
      <span class="jde-stamp" aria-hidden="true"></span>
      <span class="jde-lab">${label}</span>
      <span class="jde-shine" aria-hidden="true"></span>
    </a>`;
}
