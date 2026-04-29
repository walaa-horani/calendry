"use client";

import React from "react";
import { Video, CreditCard, Database, MessageCircle, Mail, Calendar, Smartphone } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

const ConnectionTools = () => {
  return (
    <section className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 flex flex-col lg:flex-row items-center justify-between gap-12 overflow-hidden bg-white">
      {/* Left Column: Content */}
      <div className="w-full lg:w-5/12 flex flex-col items-start text-left z-10">
        <h2 className="text-4xl lg:text-5xl font-extrabold text-[#0B3558] tracking-tight leading-[1.15] mb-6">
          Connect your favorite tools
        </h2>
        <p className="text-lg text-slate-500 mb-8 max-w-md leading-relaxed">
          Calendly works with your calendar and the apps you use every day to automate scheduling and keep your workflow seamless.
        </p>

        <Link href="#">
          <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white py-3.5 px-8 rounded-full font-semibold transition-colors duration-200 shadow-sm relative overflow-hidden">
            View all integrations
          </button>
        </Link>
      </div>

      {/* Right Column: Visuals */}
      <div className="w-full lg:w-7/12 relative flex justify-center items-center mt-12 lg:mt-0 min-h-[450px]">
        
        {/* Background blobs for depth */}
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
          <motion.div 
            animate={{ 
              scale: [1, 1.1, 1],
              opacity: [0.3, 0.5, 0.3]
            }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-[350px] h-[350px] bg-blue-50 rounded-full blur-3xl"
          />
        </div>

        {/* Central Anchor for exact coordinates */}
        <div className="absolute top-1/2 left-1/2 w-0 h-0 z-10">
          
          {/* Animated Connecting Lines */}
          <svg className="absolute overflow-visible z-0 pointer-events-none" width="0" height="0">
            <ConnectingLine delay={0.2} x2={-130} y2={-100} />
            <ConnectingLine delay={0.4} x2={130} y2={-100} />
            <ConnectingLine delay={0.6} x2={-130} y2={110} />
            <ConnectingLine delay={0.8} x2={130} y2={110} />
            <ConnectingLine delay={1.0} x2={-200} y2={5} />
            <ConnectingLine delay={1.2} x2={200} y2={-5} />
          </svg>

          {/* Core Calendar Icon */}
          <div className="absolute -translate-x-1/2 -translate-y-1/2 z-20">
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="w-24 h-24 bg-[#1A73E8] rounded-[2rem] shadow-xl flex items-center justify-center"
            >
              <Calendar className="w-10 h-10 text-white" strokeWidth={2} />
            </motion.div>
          </div>

          {/* Floating Integration Icons */}
          <IntegrationIcon 
            icon={<Video className="w-7 h-7 text-[#2D8CFF]" />} 
            delay={0.2} 
            x={-130} y={-100}
            bgColor="bg-white"
          />
          
          <IntegrationIcon 
            icon={<Mail className="w-7 h-7 text-[#EA4335]" />} 
            delay={0.4} 
            x={130} y={-100}
            bgColor="bg-white"
          />

          <IntegrationIcon 
            icon={<CreditCard className="w-7 h-7 text-[#635BFF]" />} 
            delay={0.6} 
            x={-130} y={110}
            bgColor="bg-white"
          />

          <IntegrationIcon 
            icon={<MessageCircle className="w-7 h-7 text-[#4A154B]" />} 
            delay={0.8} 
            x={130} y={110}
            bgColor="bg-white"
          />

          <IntegrationIcon 
            icon={<Database className="w-7 h-7 text-[#00A1E0]" />} 
            delay={1.0} 
            x={-200} y={5}
            bgColor="bg-white"
          />

          <IntegrationIcon 
            icon={<Smartphone className="w-7 h-7 text-[#10B981]" />} 
            delay={1.2} 
            x={200} y={-5}
            bgColor="bg-white"
          />

        </div>
      </div>
    </section>
  );
};

const IntegrationIcon = ({ icon, delay, x, y, bgColor }: { icon: React.ReactNode, delay: number, x: number, y: number, bgColor: string }) => {
  return (
    <div
      className="absolute z-10"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ 
          type: "spring", 
          stiffness: 200, 
          damping: 20, 
          delay 
        }}
      >
        <motion.div 
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 3 + delay * 0.5, repeat: Infinity, ease: "easeInOut" }}
          className={`w-16 h-16 rounded-2xl ${bgColor} shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center justify-center border border-slate-100`}
        >
          {icon}
        </motion.div>
      </motion.div>
    </div>
  );
};

const ConnectingLine = ({ delay, x2, y2 }: { delay: number, x2: number, y2: number }) => {
  return (
    <motion.line
      x1="0"
      y1="0"
      x2={x2}
      y2={y2}
      stroke="#CBD5E1"
      strokeWidth="2"
      strokeDasharray="4 4"
      initial={{ pathLength: 0, opacity: 0 }}
      whileInView={{ pathLength: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay, ease: "easeOut" }}
    />
  );
};

export default ConnectionTools;