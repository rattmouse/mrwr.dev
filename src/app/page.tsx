import HomeDesktop from "@/components/HomeDesktop";
import { getVersions } from "@/lib/versions";

export default function Home() {
  const versions = getVersions();
  return <HomeDesktop versions={versions} />;
}
