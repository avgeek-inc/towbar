import { ErrorScreen } from "@/components/error-screen";

export default function NotFound() {
  return (
    <ErrorScreen
      code="404"
      title="Page not found"
      description="The address may be incorrect, or this page may have moved. Return to the overview to find your way back."
    />
  );
}
