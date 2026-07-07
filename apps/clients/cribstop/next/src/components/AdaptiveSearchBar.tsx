'use client';

import { useApp } from '@/lib/context';
import { AnimatePresence, motion } from 'motion/react';
import SearchBarHomes from './SearchBarHomes';
import SearchBarServices from './SearchBarServices';
import SearchBarConnect from './SearchBarConnect';

export default function AdaptiveSearchBar({ onDone }: { onDone?: () => void }) {
  const { activeTab } = useApp();

  return (
    <div className="w-full px-4 py-4">
      <AnimatePresence mode="wait">
        {activeTab === 'homes' && (
          <motion.div
            key="homes"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <SearchBarHomes onDone={onDone} />
          </motion.div>
        )}
        {activeTab === 'services' && (
          <motion.div
            key="services"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <SearchBarServices onDone={onDone} />
          </motion.div>
        )}
        {activeTab === 'connect' && (
          <motion.div
            key="connect"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <SearchBarConnect onDone={onDone} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
