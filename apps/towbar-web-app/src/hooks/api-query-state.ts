export function canKeepQueryData(
  previousPath: string,
  path: string | null,
  keepPreviousData: boolean,
) {
  return (
    keepPreviousData &&
    path !== null &&
    previousPath.split("?")[0] === path.split("?")[0]
  );
}
