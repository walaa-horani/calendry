import Hero from "../components/Hero";
import ConnectionTools from "../components/ConnectionTools";
import Plans from "../components/Plans";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Hero />
      <ConnectionTools />
      <Plans />
    </div>
  );
}
