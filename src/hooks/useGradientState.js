import { useState } from 'react';

export function useGradientState(activeSection = null) {
  const [imageURL, setImageURL] = useState(null);
  const [section, setSection] = useState(activeSection);

  const gradientState = { imageURL, section };
  const setGradientState = (newImageURL = null, newSection = null) => {
    setImageURL(newImageURL);
    setSection(newSection);
  };

  return [gradientState, setGradientState];
}
