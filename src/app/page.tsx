import OnboardingForm from "@/components/onboarding/OnboardingForm";

export default function Home() {
  return (
    <>
      <h1>어떤 곳에서 살고 싶으세요?</h1>
      <p className="muted">집값은 잠시 잊고, 내 생활방식에 맞는 동네를 찾아드려요.</p>
      <OnboardingForm />
    </>
  );
}
