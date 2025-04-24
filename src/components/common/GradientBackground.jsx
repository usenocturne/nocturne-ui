import { useEffect } from 'react';
import { useGradientTransition } from '../../hooks/useGradientTransition';

const GradientBackground = ({
  gradientState = {
    imageURL: null,
    section: null,
  },
}) => {
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientTransition(gradientState.section);

  useEffect(() => {
    updateGradientColors(gradientState.imageURL, gradientState.section);
  }, [updateGradientColors, gradientState]);

  return (
    <div
      style={{
        backgroundImage: generateMeshGradient([
          currentColor1,
          currentColor2,
          currentColor3,
          currentColor4,
        ]),
        transition: 'background-image 0.5s linear',
      }}
      className="absolute inset-0"
    />
  );
};

export default GradientBackground;
