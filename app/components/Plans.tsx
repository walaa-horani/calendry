"use client";

import React, { useState } from "react";
import { motion, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";

const plans = [
  {
    name: "Free",
    desc: "For personal use",
    priceDisplay: "Always free",
    buttonText: "Get started",
    buttonVariant: "dark",
  },
  {
    name: "Standard",
    desc: "For professionals and small teams",
    price: "$10",
    period: "/seat/mo",
    save: "Save 16%",
    buttonText: "Get started",
    buttonVariant: "blue",
  },
  {
    name: "Teams",
    desc: "For growing businesses",
    price: "$16",
    period: "/seat/mo",
    save: "Save 20%",
    buttonText: "Try for Free",
    buttonVariant: "blue",
    recommended: true,
  },
  {
    name: "Enterprise",
    desc: "For large companies",
    prefix: "Starts at",
    price: "$15k",
    period: "/yr",
    buttonText: "Talk to sales",
    buttonVariant: "blue",
  }
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 20,
    },
  },
};

const Plans = () => {
  const [isYearly, setIsYearly] = useState(true);

  return (
    <section className="w-full bg-white py-24 relative font-sans">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-[40px] md:text-[44px] font-extrabold text-[#0B3558] leading-[1.15] tracking-tight mb-6 max-w-xl"
        >
          Pick the perfect plan<br />for your team
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex items-center gap-6 mb-12"
        >
          <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setIsYearly(true)}>
            <div className={`w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center transition-colors ${isYearly ? 'border-[#006BFF]' : 'border-slate-400 group-hover:border-slate-500'}`}>
              {isYearly && <div className="w-[10px] h-[10px] rounded-full bg-[#006BFF]" />}
            </div>
            <span className="text-[15px] text-[#0B3558] font-medium">Billed yearly</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setIsYearly(false)}>
            <div className={`w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center transition-colors ${!isYearly ? 'border-[#006BFF]' : 'border-slate-400 group-hover:border-slate-500'}`}>
              {!isYearly && <div className="w-[10px] h-[10px] rounded-full bg-[#006BFF]" />}
            </div>
            <span className="text-[15px] text-[#0B3558] font-medium">Billed monthly</span>
          </label>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              variants={cardVariants}
              className="relative bg-white rounded-[16px] p-8 shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100 flex flex-col h-full min-h-[260px]"
            >
              {plan.recommended && (
                <div className="absolute -top-3 right-6 bg-[#006BFF] text-white text-[11px] font-bold px-3 py-1.5 rounded-md shadow-sm">
                  Recommended plan
                </div>
              )}

              <div>
                <h3 className="text-[22px] font-bold text-[#0B3558] mb-1.5">{plan.name}</h3>
                <p className="text-[14px] text-slate-500 leading-snug">{plan.desc}</p>
              </div>

              <div className="mt-8 mb-auto">
                {plan.priceDisplay ? (
                  <div className="text-[22px] font-bold text-[#0B3558] pt-2">{plan.priceDisplay}</div>
                ) : (
                  <div className="flex items-baseline gap-1 flex-wrap">
                    {plan.prefix && (
                      <span className="text-[14px] text-[#0B3558] font-semibold mr-1">{plan.prefix}</span>
                    )}
                    <span className="text-[40px] font-extrabold text-[#0B3558] leading-none tracking-tight">
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-[12px] text-slate-500 font-medium border-b-[1.5px] border-dotted border-slate-400 pb-[1px] relative -top-1">
                        {plan.period}
                      </span>
                    )}
                    {plan.save && isYearly && (
                      <span className="ml-2 bg-[#e8f1ff] text-[#006BFF] text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        {plan.save}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                className={`w-full py-3 rounded-[10px] font-semibold text-[15px] transition-colors mt-8 ${
                  plan.buttonVariant === 'dark'
                    ? 'bg-[#0B3558] text-white hover:bg-[#0B3558]/90'
                    : 'bg-[#006BFF] text-white hover:bg-[#006BFF]/90'
                }`}
              >
                {plan.buttonText}
              </button>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12"
        >
          <a href="#" className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#0B3558] hover:text-[#006BFF] transition-colors">
            Learn more on our pricing page
            <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          </a>
        </motion.div>
      </div>
    </section>
  );
};

export default Plans;