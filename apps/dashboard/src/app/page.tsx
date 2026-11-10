import React from "react";
import { LandingRedirect } from "@/components/landing-redirect";

// Landing page using the provided static HTML.
export default function LandingPage() {
  return (
        <>
            <LandingRedirect />
            <div dangerouslySetInnerHTML={{ __html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>SwayamMail — Email Infrastructure for India</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        :root { --white: #ffffff; --off: #fafaf9; --border: #e7e7e4; --text: #1c1c1a; --text-muted: #71716a; --accent: #059669; --blue: #2563eb; }
        body { background-color: var(--white); color: var(--text); font-family: 'Geist', sans-serif; scroll-behavior: smooth; }
        .serif { font-family: 'Fraunces', serif; }
        .mono { font-family: 'Geist Mono', monospace; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: var(--off); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
        .glass-nav { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
        .hero-gradient { background: radial-gradient(circle at 50% -20%, #f0fdf4 0%, #ffffff 50%); }
        .card-shadow { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); border: 1px solid var(--border); }
        .step-dot::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 100%; background: var(--border); z-index: 0; }
        .panel { display: none; } .panel.active { display: block; animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .verified-badge { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; }
    </style>
</head>
<body>
    <nav class="glass-nav fixed top-0 w-full z-50 h-16 flex items-center justify-between px-6 md:px-12">
        <div class="flex items-center gap-2">
            <div class="w-7 h-7 bg-black rounded flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M1 4.5L6 7.5L11 4.5" stroke="white" stroke-width="1.2"/><rect x="1" y="3" width="10" height="7" rx="1.5" stroke="white" stroke-width="1.2"/></svg>
            </div>
            <span class="serif text-lg font-medium tracking-tight">SwayamMail</span>
        </div>
        <div class="hidden md:flex items-center gap-8 text-sm font-medium text-[#71716a]">
            <a href="#features" class="hover:text-black">Features</a>
            <a href="/docs" class="hover:text-black">API</a>
            <a href="#pricing" class="hover:text-black">Pricing</a>
        </div>
            <div class="flex items-center gap-4">
            <span class="hidden sm:inline mono text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">BETA v0.4</span>
            <a href="/signin" class="bg-black text-white text-sm px-4 py-2 rounded-lg font-medium hover:opacity-80 transition-all">Sign In</a>
        </div>
    </nav>

    <section class="hero-gradient pt-32 pb-20 px-6">
        <div class="max-w-4xl mx-auto text-center">
            <div class="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-xs font-medium mb-8 card-shadow">
                <span class="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Now Live: Domain Verification & HTML Campaigns
            </div>
            <h1 class="serif text-5xl md:text-7xl mb-6 tracking-tight leading-[1.1]">Own your sender <br/><span class="text-gray-400 italic">reputation.</span></h1>
            <p class="text-lg md:text-xl text-gray-500 mb-10 max-w-2xl mx-auto leading-relaxed">Connect your domain, upload your lists, and start sending high-delivery TXT or HTML emails in minutes. Built for the Indian ecosystem.</p>

            <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                <a href="#get-started" class="w-full sm:w-auto bg-black text-white px-8 py-4 rounded-xl font-semibold text-lg hover:scale-[1.02] transition-transform shadow-lg shadow-black/10">Get Started for Free</a>
                <a href="/docs" class="w-full sm:w-auto bg-white text-black border border-gray-200 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-gray-50">Read Documentation</a>
            </div>

            <div class="max-w-3xl mx-auto">
                <div class="flex justify-center gap-2 mb-4">
                    <button onclick="switchTab('business', this)" class="tab-btn px-4 py-2 text-sm font-medium rounded-full bg-gray-100 text-gray-500 active-tab [&.active]:bg-black [&.active]:text-white active">Business Suite</button>
                    <button onclick="switchTab('developer', this)" class="tab-btn px-4 py-2 text-sm font-medium rounded-full bg-gray-100 text-gray-500 [&.active]:bg-black [&.active]:text-white">Developer API</button>
                </div>

                <div class="bg-white border border-gray-200 rounded-2xl p-2 card-shadow">
                    <div id="business-panel" class="panel active p-6 text-left">
                        <div class="flex items-center justify-between mb-8 pb-4 border-bottom border-gray-100 border-b">
                            <div>
                                <h3 class="font-semibold text-sm">Sender Identity</h3>
                                <p class="text-xs text-gray-400">Manage your verified domains</p>
                            </div>
                            <button class="text-xs font-semibold text-blue-600">+ Add Domain</button>
                        </div>
                        
                        <div class="space-y-4">
                            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div class="flex items-center gap-3">
                                    <div class="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-xs">✓</div>
                                    <div>
                                        <div class="text-sm font-medium">newsletter.mybrand.in</div>
                                        <div class="text-[10px] text-gray-400 mono uppercase tracking-wider">SPF • DKIM • DMARC</div>
                                    </div>
                                </div>
                                <span class="verified-badge">ACTIVE</span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div class="p-4 border border-gray-100 rounded-xl">
                                    <div class="text-[10px] text-gray-400 uppercase font-bold mb-1">Total Contacts</div>
                                    <div class="text-2xl font-semibold">12,402</div>
                                    <div class="text-[10px] text-emerald-600 mt-1">+12% this week</div>
                                </div>
                                <div class="p-4 border border-gray-100 rounded-xl">
                                    <div class="text-[10px] text-gray-400 uppercase font-bold mb-1">Deliverability</div>
                                    <div class="text-2xl font-semibold">99.8%</div>
                                    <div class="text-[10px] text-emerald-600 mt-1">Excellent reputation</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="developer-panel" class="panel p-6 text-left">
                        <div class="bg-[#111] rounded-xl p-6 mono text-[13px] leading-relaxed overflow-x-auto">
                            <div class="flex gap-2 mb-4 border-b border-white/10 pb-4">
                                <span class="text-white/40">POST</span>
                                <span class="text-emerald-400">/v1/send</span>
                            </div>
                            <div class="text-gray-400">{
                                &nbsp;&nbsp;<span class="text-purple-400">"from"</span>: <span class="text-emerald-300">"marketing@mybrand.in"</span>,
                                &nbsp;&nbsp;<span class="text-purple-400">"to"</span>: <span class="text-emerald-300">"customer@gmail.com"</span>,
                                &nbsp;&nbsp;<span class="text-purple-400">"subject"</span>: <span class="text-emerald-300">"Welcome to the family"</span>,
                                &nbsp;&nbsp;<span class="text-purple-400">"format"</span>: <span class="text-emerald-300">"html"</span>,
                                &nbsp;&nbsp;<span class="text-purple-400">"body"</span>: <span class="text-emerald-300">"&lt;h1&gt;Namaste!&lt;/h1&gt;..."</span>
                            }</n
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section id="features" class="py-24 border-t border-gray-100">
        <div class="max-w-6xl mx-auto px-6">
            <div class="text-center mb-16">
                <h2 class="serif text-4xl mb-4 tracking-tight">Three steps to inbox mastery.</h2>
                <p class="text-gray-500">Stop worrying about spam folders. Focus on the content.</p>
            </div>

            <div class="grid md:grid-cols-3 gap-12">
                <div class="relative pl-12 md:pl-0 md:text-center">
                    <div class="md:mx-auto w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-bold mb-6">1</div>
                    <h3 class="font-bold text-xl mb-3">Verify Domain</h3>
                    <p class="text-gray-500 text-sm leading-relaxed">Add your domain and we'll give you the DNS records. We verify SPF, DKIM, and DMARC automatically to ensure your emails are trusted.</p>
                </div>
                <div class="relative pl-12 md:pl-0 md:text-center">
                    <div class="md:mx-auto w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-bold mb-6">2</div>
                    <h3 class="font-bold text-xl mb-3">Build Your List</h3>
                    <p class="text-gray-500 text-sm leading-relaxed">Import contacts via CSV or sync them through our API. Organize your audience into segments for targeted communication.</p>
                </div>
                <div class="relative pl-12 md:pl-0 md:text-center">
                    <div class="md:mx-auto w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-bold mb-6">3</div>
                    <h3 class="font-bold text-xl mb-3">Compose & Send</h3>
                    <p class="text-gray-500 text-sm leading-relaxed">Send simple text-based alerts or rich HTML newsletters. Use our sandbox to test your design before it reaches your customers.</p>
                </div>
            </div>
        </div>
    </section>

    <section class="bg-gray-50 py-24 border-y border-gray-100">
        <div class="max-w-6xl mx-auto px-6">
            <div class="grid md:grid-cols-2 gap-20 items-center">
                <div>
                    <h2 class="serif text-4xl mb-6 leading-tight">The developer's choice for <em>transactional</em> mail.</h2>
                    <div class="space-y-6">
                        <div class="flex gap-4">
                            <div class="w-6 h-6 bg-emerald-100 rounded text-emerald-600 flex-shrink-0 flex items-center justify-center text-xs">✓</div>
                            <div>
                                <h4 class="font-bold text-sm">Lightning Fast Delivery</h4>
                                <p class="text-gray-500 text-xs mt-1">Our nodes are optimized for local Indian ISPs, ensuring your OTPs land instantly.</p>
                            </div>
                        </div>
                        <div class="flex gap-4">
                            <div class="w-6 h-6 bg-emerald-100 rounded text-emerald-600 flex-shrink-0 flex items-center justify-center text-xs">✓</div>
                            <div>
                                <h4 class="font-bold text-sm">Sender Authentication</h4>
                                <p class="text-gray-500 text-xs mt-1">Manage multiple "Sender Emails" under a single verified domain for different business units.</p>
                            </div>
                        </div>
                        <div class="flex gap-4">
                            <div class="w-6 h-6 bg-emerald-100 rounded text-emerald-600 flex-shrink-0 flex items-center justify-center text-xs">✓</div>
                            <div>
                                <h4 class="font-bold text-sm">Flexible Pay-as-you-go</h4>
                                <p class="text-gray-500 text-xs mt-1">No monthly lock-ins during beta. Pay only for what you send via UPI/Razorpay.</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-2xl card-shadow rotate-1 hidden md:block">
                    <img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800" alt="Interface preview" class="rounded-xl grayscale hover:grayscale-0 transition-all duration-700"/>
                </div>
            </div>
        </div>
    </section>

    <section class="py-24">
        <div class="max-w-3xl mx-auto px-6">
            <h2 class="serif text-3xl text-center mb-12">Current Status & Roadmap</h2>
            <div class="space-y-12">
                <div class="flex gap-8 relative">
                    <div class="w-4 h-4 rounded-full bg-emerald-500 mt-1 flex-shrink-0 z-10"></div>
                    <div class="absolute left-2 top-2 bottom-[-48px] w-[1px] bg-emerald-200"></div>
                    <div>
                        <div class="text-xs font-bold text-emerald-600 mono mb-1 uppercase">Completed — April 2026</div>
                        <h4 class="font-bold mb-2">Core Sending Infrastructure</h4>
                        <p class="text-gray-500 text-sm">Domain verification (SPF/DKIM), list management, and the hybrid TXT/HTML sending engine is now live.</p>
                    </div>
                </div>

                <div class="flex gap-8 relative">
                    <div class="w-4 h-4 rounded-full bg-blue-500 mt-1 flex-shrink-0 z-10 border-4 border-white"></div>
                    <div class="absolute left-2 top-2 bottom-[-48px] w-[1px] bg-gray-200"></div>
                    <div>
                        <div class="text-xs font-bold text-blue-600 mono mb-1 uppercase">In Progress — Q2 2026</div>
                        <h4 class="font-bold mb-2">Open Beta & Monitoring</h4>
                        <p class="text-gray-500 text-sm">Onboarding early access users and refining the real-time bounce/complaint monitoring dashboard.</p>
                    </div>
                </div>

                <div class="flex gap-8 relative">
                    <div class="w-4 h-4 rounded-full bg-gray-200 mt-1 flex-shrink-0 z-10 border-4 border-white"></div>
                    <div>
                        <div class="text-xs font-bold text-gray-400 mono mb-1 uppercase">Upcoming — Q3 2026</div>
                        <h4 class="font-bold mb-2">AI-Template Studio</h4>
                        <p class="text-gray-500 text-sm">Prompt-to-Email generation for non-technical users to build stunning marketing assets without code.</p>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section id="get-started" class="py-24 bg-black text-white text-center">
        <div class="max-w-2xl mx-auto px-6">
            <h2 class="serif text-4xl mb-6">Ready to improve your delivery?</h2>
            <p class="text-gray-400 mb-10">Join founders and developers building on SwayamMail. No credit card required to start.</p>
            <form onsubmit="redirectToSignup(event)" class="flex flex-col sm:flex-row gap-3">
                <input name="email" type="email" placeholder="work@company.in" class="flex-1 bg-white/10 border border-white/20 px-4 py-3 rounded-xl focus:outline-none focus:border-emerald-500 transition-colors" required/>
                <button type="submit" class="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-emerald-500 hover:text-white transition-all">Create Account</button>
            </form>
            <p class="text-[10px] text-gray-500 mt-4 mono uppercase tracking-widest">Free during beta • Secure via Razorpay • 24/7 Support</p>
        </div>
    </section>

    <section id="pricing" class="py-20 bg-white border-t border-gray-100">
        <div class="max-w-6xl mx-auto px-6 text-center">
            <h2 class="serif text-3xl mb-4">Pricing</h2>
            <p class="text-muted mb-8">India-first pricing with zero forex friction via Razorpay. Overage: ₹15 per 1,000 emails. All prices exclude 18% GST.</p>
            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
                <div class="p-6 border border-gray-150 rounded-xl flex flex-col justify-between">
                    <div>
                        <div class="text-xs uppercase text-muted font-bold tracking-wider mb-1">Free</div>
                        <h3 class="text-3xl font-semibold my-2">₹0</h3>
                        <p class="text-sm text-gray-500">1,000 emails / month</p>
                    </div>
                    <div class="mt-6"><a href="#get-started" class="inline-block w-full text-center bg-black text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors">Get Free</a></div>
                </div>
                <div class="p-6 border border-gray-150 rounded-xl flex flex-col justify-between">
                    <div>
                        <div class="text-xs uppercase text-muted font-bold tracking-wider mb-1">Starter</div>
                        <h3 class="text-3xl font-semibold my-2">₹499<span class="text-sm font-normal text-muted">/mo + GST</span></h3>
                        <p class="text-sm text-gray-500">25,000 emails / month</p>
                    </div>
                    <div class="mt-6"><a href="/signin?mode=signup" class="inline-block w-full text-center bg-black text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors">Get Started</a></div>
                </div>
                <div class="p-6 border border-gray-150 rounded-xl flex flex-col justify-between">
                    <div>
                        <div class="text-xs uppercase text-muted font-bold tracking-wider mb-1">Growth</div>
                        <h3 class="text-3xl font-semibold my-2">₹1,499<span class="text-sm font-normal text-muted">/mo + GST</span></h3>
                        <p class="text-sm text-gray-500">100,000 emails / month</p>
                    </div>
                    <div class="mt-6"><a href="/signin?mode=signup" class="inline-block w-full text-center bg-black text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors">Get Growth</a></div>
                </div>
                <div class="p-6 border border-gray-150 rounded-xl flex flex-col justify-between">
                    <div>
                        <div class="text-xs uppercase text-muted font-bold tracking-wider mb-1">Scale</div>
                        <h3 class="text-3xl font-semibold my-2">₹5,999<span class="text-sm font-normal text-muted">/mo + GST</span></h3>
                        <p class="text-sm text-gray-500">500,000 emails / month</p>
                    </div>
                    <div class="mt-6"><a href="/signin?mode=signup" class="inline-block w-full text-center bg-black text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors">Get Scale</a></div>
                </div>
            </div>
        </div>
    </section>

    <footer class="py-12 border-t border-gray-100 text-center">
        <div class="serif text-xl mb-4">SwayamMail</div>
        <p class="text-gray-400 text-xs mb-6">© 2026 Yugaas, Hyderabad, India.</p>
        <div class="flex justify-center gap-6 text-xs font-medium text-gray-500">
            <a href="#">Twitter</a>
            <a href="#">Status</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
        </div>
    </footer>

    <script>
        function switchTab(type, btn) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.getElementById(type + '-panel').classList.add('active');
        }

        function redirectToSignup(e) {
            e.preventDefault();
            const input = document.querySelector('input[name="email"]');
            const email = input && input.value ? input.value.trim() : null;
            if (email) {
                window.location.href = '/signin?email=' + encodeURIComponent(email);
            } else {
                window.location.href = '/signin?mode=signup';
            }
        }
    </script>
</body>
</html>
        ` }} />
        </>
  );
}
