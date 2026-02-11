import HomeDesktop from "@/components/HomeDesktop";
import { getGitChanges } from "@/lib/gitChanges";

export default function Home() {
  const gitChanges = getGitChanges(120);
  return <HomeDesktop gitChanges={gitChanges} />;
}
