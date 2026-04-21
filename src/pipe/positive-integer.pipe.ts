import { PipeTransform, BadRequestException } from '@nestjs/common';

export class PositiveIntPipe implements PipeTransform {
  transform(value: any): number {
    const val = Number(value);

    if (!Number.isInteger(val) || val <= 0) {
      throw new BadRequestException('provinceCode phải là số nguyên dương');
    }

    return val;
  }
}
