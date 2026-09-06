import HomeDesktop from "@/components/HomeDesktop";
import { getVersions } from "@/lib/versions";
import { getSearchHistory } from "@/lib/searchHistory";

export default function Home() {
  const versions = getVersions();
  const searchHistory = getSearchHistory();
  return <HomeDesktop versions={versions} searchHistory={searchHistory} />;
}
