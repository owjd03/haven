import AppearanceSettings from "./AppearanceSettings";
import PrivacyView from "./PrivacyView";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Settings · Haven" };

export default function SettingsPage() {
  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8">
      <PageTitle where="private">Settings</PageTitle>
      <AppearanceSettings />
      <PrivacyView />
    </div>
  );
}
