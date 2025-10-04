// Array utility functions

/**
 * Split array into chunks of specified size
 */
export function chunk(arr, size) {
  return arr.reduce((acc, _, i) => 
    (i % size ? acc : [...acc, arr.slice(i, i + size)]), 
    []
  );
}
