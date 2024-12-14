import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TutorialStep {
  target: string;  // CSS selector for the target element
  content: string;
  position: 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  action?: 'click' | 'input' | 'hover';
  nextTrigger?: 'auto' | 'click';  // Whether to auto-advance or wait for click
  delay?: number;  // Delay before auto-advancing
}

interface TutorialOverlayProps {
  steps: TutorialStep[];
  isActive: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  steps,
  isActive,
  onComplete,
  onSkip,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlight, setHighlight] = useState<DOMRect | null>(null);

  React.useEffect(() => {
    if (isActive) {
      setCurrentStep(0); // Reset to first step when tutorial becomes active
      if (steps[0]) {
        updateHighlight(steps[0].target);
      }
    }
  }, [isActive]); // Only depend on isActive

  React.useEffect(() => {
    if (isActive && steps[currentStep]) {
      updateHighlight(steps[currentStep].target);

      // Handle auto-advance
      if (steps[currentStep].nextTrigger === 'auto') {
        const timer = setTimeout(() => {
          handleNext();
        }, steps[currentStep].delay || 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [currentStep, isActive]); // Depend on currentStep and isActive

  const updateHighlight = (selector: string) => {
    const element = document.querySelector(selector);
    if (element) {
      const rect = element.getBoundingClientRect();
      setHighlight(rect);
    } else {
      console.warn('Element not found for selector:', selector);
    }
  };

  React.useEffect(() => {
    if (isActive && steps[currentStep]) {
      updateHighlight(steps[currentStep].target);

      // Handle auto-advance
      if (steps[currentStep].nextTrigger === 'auto') {
        const timer = setTimeout(() => {
          handleNext();
        }, steps[currentStep].delay || 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [currentStep, isActive]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Highlight cutout */}
      <AnimatePresence>
        {highlight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bg-transparent"
            style={{
              top: highlight.top - 4,
              left: highlight.left - 4,
              width: highlight.width + 8,
              height: highlight.height + 8,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              borderRadius: '4px',
              border: '2px solid #60A5FA'
            }}
          />
        )}
      </AnimatePresence>

      {/* Tutorial content */}
      {highlight && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute pointer-events-auto bg-white rounded-lg shadow-lg p-3 max-w-sm"
          style={{
            ...getPositionStyles(highlight, steps[currentStep].position)
          }}
        >
          <p className="text-sm mb-3 text-left">{steps[currentStep].content}</p>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">
              Step {currentStep + 1} of {steps.length}
            </span>
            <div className="space-x-2">
              <button
                onClick={onSkip}
                className="text-xs text-black hover:text-gray-700"
              >
                Skip
              </button>
              {currentStep > 0 && (
                <button
                  onClick={handleBack}
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

// Helper function to position the tooltip
const getPositionStyles = (
  targetRect: DOMRect,
  position: TutorialStep['position']
) => {
  const SPACING = 12;
  const base = {
    position: 'absolute' as const,
  };

  switch (position) {
    case 'top':
      return {
        ...base,
        bottom: window.innerHeight - targetRect.top + SPACING,
        left: targetRect.left + (targetRect.width / 2),
        transform: 'translateX(-50%)',
      };
    case 'bottom':
      return {
        ...base,
        top: targetRect.bottom + SPACING,
        left: targetRect.left + (targetRect.width / 2),
        transform: 'translateX(-50%)',
      };
    case 'left':
      return {
        ...base,
        top: targetRect.top + (targetRect.height / 2),
        right: window.innerWidth - targetRect.left + SPACING,
        transform: 'translateY(-50%)',
      };
    case 'right':
      return {
        ...base,
        top: targetRect.top + (targetRect.height / 2),
        left: targetRect.right + SPACING,
        transform: 'translateY(-50%)',
      };
    case 'top-left':
      return {
        ...base,
        bottom: window.innerHeight - targetRect.top + SPACING,
        left: targetRect.left + SPACING,
      };
    case 'top-right':
      return {
        ...base,
        bottom: window.innerHeight - targetRect.top + SPACING,
        right: window.innerWidth - targetRect.right,
      };
    case 'bottom-left':
      return {
        ...base,
        top: targetRect.bottom + SPACING,
        left: targetRect.left,
      };
    case 'bottom-right':
      return {
        ...base,
        top: targetRect.bottom + SPACING,
        right: window.innerWidth - targetRect.right,
      };
  }
};