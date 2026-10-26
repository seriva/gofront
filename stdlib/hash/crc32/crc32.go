//go:build gofront

//gofront:target both

// Package crc32 implements the 32-bit cyclic redundancy check, or CRC-32,
// checksum.
package crc32

import (
	"hash"
)

// The size of a CRC-32 checksum in bytes.
const Size = 4

// Predefined polynomials.
const (
	// IEEE is by far and away the most common CRC-32 polynomial.
	IEEE = 0xedb88320

	// Castagnoli's polynomial, used in iSCSI.
	Castagnoli = 0x82f63b78

	// Koopman's polynomial.
	Koopman = 0xeb31d82e
)

// Table is a 256-word table representing the polynomial for efficient processing.
type Table [256]uint32

func populateTable(poly uint32, t *Table) {
	for i := 0; i < 256; i++ {
		crc := uint32(i)
		for j := 0; j < 8; j++ {
			if crc&1 == 1 {
				crc = (crc >> 1) ^ poly
			} else {
				crc >>= 1
			}
		}
		t[i] = crc
	}
}

func makeTable(poly uint32) *Table {
	t := new(Table)
	populateTable(poly, t)
	return t
}

var castagnoliTable = makeTable(Castagnoli)
var koopmanTable = makeTable(Koopman)

// IEEETable is the table for the [IEEE] polynomial.
var IEEETable = makeTable(IEEE)

// MakeTable returns a [Table] constructed from the specified polynomial.
// The contents of this [Table] must not be modified.
func MakeTable(poly uint32) *Table {
	switch poly {
	case IEEE:
		if IEEETable != nil {
			return IEEETable
		}
	case Castagnoli:
		if castagnoliTable != nil {
			return castagnoliTable
		}
	case Koopman:
		if koopmanTable != nil {
			return koopmanTable
		}
	}
	return makeTable(poly)
}

// digest represents the partial evaluation of a checksum.
type digest struct {
	crc uint32
	tab *Table
}

// New creates a new [hash.Hash32] computing the CRC-32 checksum using the
// polynomial represented by the [Table].
func New(tab *Table) hash.Hash32 {
	return &digest{0, tab}
}

// NewIEEE creates a new [hash.Hash32] computing the CRC-32 checksum using
// the [IEEE] polynomial.
func NewIEEE() hash.Hash32 {
	return New(IEEETable)
}

func (d *digest) Size() int { return Size }

func (d *digest) BlockSize() int { return 1 }

func (d *digest) Reset() { d.crc = 0 }

func (d *digest) Clone() (hash.Cloner, error) {
	r := *d
	return &r, nil
}

// Update returns the result of adding the bytes in p to the crc.
func Update(crc uint32, tab *Table, p []byte) uint32 {
	crc = ^crc
	for _, v := range p {
		crc = tab[byte(crc)^v] ^ (crc >> 8)
	}
	return ^crc
}

func (d *digest) Write(p []byte) (n int, err error) {
	d.crc = Update(d.crc, d.tab, p)
	return len(p), nil
}

func (d *digest) Sum32() uint32 { return d.crc }

func (d *digest) Sum(in []byte) []byte {
	s := d.Sum32()
	return append(in, byte(s>>24), byte(s>>16), byte(s>>8), byte(s))
}

// Checksum returns the CRC-32 checksum of data
// using the polynomial represented by the [Table].
func Checksum(data []byte, tab *Table) uint32 {
	return Update(0, tab, data)
}

// ChecksumIEEE returns the CRC-32 checksum of data
// using the [IEEE] polynomial.
func ChecksumIEEE(data []byte) uint32 {
	return Update(0, IEEETable, data)
}
