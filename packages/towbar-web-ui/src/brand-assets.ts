const brandImageBaseUrl =
  "https://www.towbar.dev/cdn-cgi/imagedelivery/phvjnb9w1G6QHeeoMJptkQ";

function brandImageSource(customId: string, width: number) {
  return `${brandImageBaseUrl}/${customId}/w=${width},fit=scale-down`;
}

export function getTowbarBrandFaviconSource() {
  return brandImageSource("brands/towbar/favicon", 256);
}

export function getTowbarBrandLogoSource(theme: "dark" | "light") {
  return brandImageSource(`brands/towbar/logo/${theme}-transparent-edge`, 128);
}
